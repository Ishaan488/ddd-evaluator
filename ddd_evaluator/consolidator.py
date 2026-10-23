"""The fourth model reconciles the three rater results; code then enforces the guardrails."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from pydantic import ValidationError

from .llm import LLMError, Providers, extract_json
from .models import ConsDim, ConsolidatorResult, Dimension
from .prompts import build_consolidator_prompt
from .validator import ValidatedRater, rater_payload


@dataclass
class DimStats:
    scores: dict[str, Optional[int]]
    low: Optional[int]
    high: Optional[int]
    spread: Optional[int]
    usable: int


@dataclass
class ConsolidationRun:
    result: Optional[ConsolidatorResult] = None
    raw: str = ""
    model: str = ""
    model_version: str = ""
    error: str = ""
    attempts: int = 0
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    elapsed_s: float = 0.0
    guardrail_notes: list[str] = field(default_factory=list)


def dimension_stats(validated: list[ValidatedRater], dims: list[Dimension]) -> dict[str, DimStats]:
    stats: dict[str, DimStats] = {}
    for d in dims:
        scores = {v.rater_id: v.usable_score(d.id) for v in validated}
        values = [s for s in scores.values() if s is not None]
        stats[d.id] = DimStats(
            scores=scores,
            low=min(values) if values else None,
            high=max(values) if values else None,
            spread=(max(values) - min(values)) if values else None,
            usable=len(values),
        )
    return stats


def consolidate(providers: Providers, cons_cfg: dict, card, dims: list[Dimension], artifact, sources,
                validated: list[ValidatedRater]) -> tuple[ConsolidationRun, dict[str, DimStats]]:
    stats = dimension_stats(validated, dims)
    run = ConsolidationRun(model=cons_cfg["model"])
    try:
        provider = providers.for_model(cons_cfg)
    except LLMError as exc:
        run.error = str(exc)
        return run, stats
    payloads = {v.rater_id: rater_payload(v) for v in validated}
    stats_json = {k: {"rater_scores": s.scores, "lowest": s.low, "highest": s.high, "spread": s.spread,
                      "usable_raters": s.usable} for k, s in stats.items()}
    system, user = build_consolidator_prompt(card, dims, artifact, sources, payloads, stats_json)
    prompt = user
    for attempt in (1, 2):
        run.attempts = attempt
        try:
            resp = provider.complete(system=system, user=prompt, model=cons_cfg["model"], role="consolidator")
        except LLMError as exc:
            run.error = str(exc)
            return run, stats
        run.raw, run.model_version = resp.text, resp.model_version
        run.elapsed_s += resp.elapsed_s
        run.prompt_tokens = (run.prompt_tokens or 0) + (resp.prompt_tokens or 0)
        run.completion_tokens = (run.completion_tokens or 0) + (resp.completion_tokens or 0)
        try:
            run.result = ConsolidatorResult.model_validate(extract_json(resp.text))
            run.error = ""
            break
        except (ValueError, ValidationError) as exc:
            run.error = f"consolidator reply is not valid JSON: {str(exc)[:300]}"
            prompt = user + f"\n\nYour previous reply was rejected: {run.error}\nReturn the complete JSON object again."
    if run.result is not None:
        _apply_guardrails(run, dims, stats)
    return run, stats


def _apply_guardrails(run: ConsolidationRun, dims: list[Dimension], stats: dict[str, DimStats]) -> None:
    """Code, not the model, has the last word on the numbers."""
    result = run.result
    assert result is not None
    by_id = {d.dimension_id: d for d in result.dimensions if d.dimension_id in stats}
    final: list[ConsDim] = []
    for dim in dims:
        st = stats[dim.id]
        d = by_id.get(dim.id)
        if st.usable == 0:
            final.append(ConsDim(dimension_id=dim.id, score=None, not_measurable=True,
                                 rationale="No rater gave a usable, evidence-backed score.",
                                 flagged_for_person=True))
            continue
        if d is None or d.score is None:
            score = st.low
            run.guardrail_notes.append(f"{dim.id}: consolidator gave no score; the lowest rater score {score} was used")
            d = ConsDim(dimension_id=dim.id, score=score, basis="lower_stands", flagged_for_person=True,
                        rationale="Consolidator gave no score for this dimension; the lowest rater score stands.")
        elif not (st.low <= d.score <= st.high):
            run.guardrail_notes.append(
                f"{dim.id}: consolidator score {d.score} was outside the rater range {st.low} to {st.high}; "
                f"the lowest rater score {st.low} was used")
            d = d.model_copy(update={"score": st.low, "basis": "lower_stands", "flagged_for_person": True,
                                     "rationale": d.rationale + f" [guardrail: score outside {st.low}-{st.high}, lowest used]"})
        if st.usable == 1 and d.basis != "single_rater":
            d = d.model_copy(update={"basis": "single_rater", "flagged_for_person": True})
        if st.spread is not None and st.spread > 1 and d.basis == "agreed":
            d = d.model_copy(update={"basis": "checked"})
        if d.basis == "lower_stands" and d.score != st.low:
            run.guardrail_notes.append(f"{dim.id}: basis lower_stands but score {d.score} is not the lowest {st.low}; set to {st.low}")
            d = d.model_copy(update={"score": st.low})
        final.append(d.model_copy(update={"not_measurable": False}))
    result.dimensions = final
