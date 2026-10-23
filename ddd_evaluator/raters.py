"""Run the three raters in parallel, each in its own isolated call."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Optional

from pydantic import ValidationError

from .llm import LLMError, Providers, extract_json
from .models import RaterResult


@dataclass
class RaterRun:
    rater_id: str
    family: str
    model: str
    model_version: str = ""
    raw: str = ""
    result: Optional[RaterResult] = None
    error: str = ""
    attempts: int = 0
    elapsed_s: float = 0.0
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None

    @property
    def ok(self) -> bool:
        return self.result is not None


def _parse(raw: str, expected: list[str]) -> tuple[Optional[RaterResult], str]:
    try:
        result = RaterResult.model_validate(extract_json(raw))
    except (ValueError, ValidationError) as exc:
        return None, f"reply is not valid result JSON: {str(exc)[:300]}"
    seen: set[str] = set()
    kept = []
    for d in result.dimensions:
        if d.dimension_id in expected and d.dimension_id not in seen:
            seen.add(d.dimension_id)
            kept.append(d)
    result.dimensions = kept
    missing = [e for e in expected if e not in seen]
    if missing:
        return result, f"missing dimensions: {missing}"
    return result, ""


def run_one(providers: Providers, rater: dict, system: str, user: str, expected: list[str]) -> RaterRun:
    run = RaterRun(rater_id=rater["id"], family=rater.get("family", ""), model=rater["model"])
    try:
        provider = providers.for_model(rater)
    except LLMError as exc:
        run.error = str(exc)
        return run
    prompt = user
    best: Optional[RaterResult] = None
    for attempt in (1, 2):
        run.attempts = attempt
        try:
            resp = provider.complete(system=system, user=prompt, model=rater["model"], role=f"rater {rater['id']}")
        except LLMError as exc:
            run.error = str(exc)
            return run
        run.raw = resp.text
        run.model_version = resp.model_version
        run.elapsed_s += resp.elapsed_s
        run.prompt_tokens = (run.prompt_tokens or 0) + (resp.prompt_tokens or 0)
        run.completion_tokens = (run.completion_tokens or 0) + (resp.completion_tokens or 0)
        result, problem = _parse(resp.text, expected)
        if result is not None:
            best = result
        if not problem:
            run.result, run.error = result, ""
            return run
        run.error = problem
        prompt = (user + f"\n\nYour previous reply was rejected: {problem}\n"
                  "Return the complete JSON object again, with every listed dimension.")
    run.result = best  # accept a partial result after one retry; the validator reports what is missing
    return run


def run_raters(providers: Providers, raters: list[dict], system: str, user: str, expected: list[str],
               *, parallel: bool = True) -> list[RaterRun]:
    """Each rater is its own isolated call. Run one after another on a free tier, to stay inside the per-minute limits."""
    if not parallel:
        return [run_one(providers, r, system, user, expected) for r in raters]
    with ThreadPoolExecutor(max_workers=len(raters)) as pool:
        futures = [pool.submit(run_one, providers, r, system, user, expected) for r in raters]
        return [f.result() for f in futures]
