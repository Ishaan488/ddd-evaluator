"""One evaluation run, start to finish: load and freeze, check, rate, consolidate, decide, report, log."""
from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from . import report as report_mod
from .checks import ArtifactWorkbook, CheckResult, run_code_dimension
from .consolidator import DimStats, consolidate, dimension_stats
from .decision import decide, path_to_green
from .llm import build_providers
from .loader import (
    InputError, DEFAULT_ARTIFACT_SHEETS, detect_version, load_config, load_doc,
    load_human_evidence, load_scorecard, sha256_bytes, sha256_file,
)
from .models import (
    ConsDim, ConsFinding, ConsolidatorResult, FinalDim, FinalFinding, FinalStrength, SEVERITY_ORDER,
)
from .prompts import build_rater_prompt
from .raters import RaterRun, run_raters
from .validator import ValidatedRater, normalise, quote_found, validate_rater


@dataclass
class EvalRequest:
    artifact_spec: str
    scorecard_path: Path
    source_specs: list[str]
    config_path: Path
    out_root: Path
    human_path: Optional[Path] = None
    mock: bool = False
    allow_unfrozen: bool = False
    artifact_id: Optional[str] = None
    artifact_version: Optional[str] = None
    assume_yes: bool = False
    on_stage: Optional[Callable[[str], None]] = None  # progress hook, used by the web page


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _code_findings(results: list[CheckResult], dim_id: str, dim_name: str) -> list[FinalFinding]:
    out = []
    for r in results:
        if r.passed:
            continue
        shown = "; ".join(r.violations[:5]) + (f"; and {len(r.violations) - 5} more" if len(r.violations) > 5 else "")
        out.append(FinalFinding(
            id="", severity=r.severity, dimension_id=dim_id, dimension_name=dim_name,
            text=f"{r.id} {r.name}: {len(r.violations)} of {r.total} items fail.",
            location=shown, fix=r.fix, return_to="Define D1 (schema)", raised_by=["code"],
            verified=True, origin="code",
        ))
    return out


def _fallback_consolidation(stats: dict[str, DimStats], validated: list[ValidatedRater]) -> ConsolidatorResult:
    """Used only when the consolidator model fails: the lowest usable rater score stands, for a person to review."""
    dims, findings = [], []
    for dim_id, st in stats.items():
        if st.usable == 0:
            dims.append(ConsDim(dimension_id=dim_id, score=None, not_measurable=True, flagged_for_person=True,
                                rationale="No usable rater score and the consolidator failed."))
        else:
            dims.append(ConsDim(dimension_id=dim_id, score=st.low, basis="lower_stands", flagged_for_person=True,
                                rationale="Consolidator failed; the lowest usable rater score stands."))
    for v in validated:
        for d in v.dims.values():
            for f in d.findings:
                findings.append(ConsFinding(**f.model_dump(), dimension_id=d.dimension_id, raised_by=[v.rater_id]))
    return ConsolidatorResult(dimensions=dims, findings=findings, strengths=[])


def family_note(raters_cfg: list[dict]) -> str:
    families = [r.get("family", r["id"]) for r in raters_cfg]
    if len(set(families)) == 1:
        return (f"All {len(families)} raters come from one model family ({families[0]}). Their blind spots may be shared, so "
                "agreement between them is weaker evidence than with three families (slide 10). Treat the verdict as advisory "
                "and have a person review every amber and red.")
    if len(set(families)) < len(families):
        return "Two raters use the same model family, so their blind spots may be shared. Slide 10 asks for different families."
    return ""


def external_notice(cfg: dict, raters_cfg: list[dict], cons_cfg: dict, n_sources: int) -> str:
    specs = raters_cfg + [cons_cfg]
    names = sorted({s.get("provider", cfg.get("provider", "gemini")) for s in specs})
    models = ", ".join(dict.fromkeys(s["model"] for s in specs))
    text = (f"The artifact and {n_sources} source document(s) will be sent to: {', '.join(names)} (models: {models}).\n"
            "Send only what client terms and data protection law allow.")
    if "gemini" in names:
        text += ("\nOn the free Gemini API tier, Google may use what you send to improve its products and human reviewers may "
                 "read it. Do not send confidential or personal data on the free tier.")
    return text


def run_evaluation(req: EvalRequest, confirm: Callable[[str], bool] = lambda msg: True) -> tuple[dict, Path]:
    stage = req.on_stage or (lambda s: None)
    stage("Loading and freezing the inputs")
    cfg = load_config(req.config_path)
    card, card_hash = load_scorecard(req.scorecard_path, allow_unfrozen=req.allow_unfrozen)
    card_file_hash = sha256_file(req.scorecard_path)
    artifact = load_doc(req.artifact_spec, default_sheets=DEFAULT_ARTIFACT_SHEETS)
    sources = [load_doc(s) for s in req.source_specs]
    human = load_human_evidence(req.human_path)
    unknown_human = [k for k in human if k not in {d.id for d in card.by_kind("human")}]
    if unknown_human:
        raise InputError(f"human evidence names dimensions that are not human-scored: {unknown_human}")

    run_id = f"{_now():%Y%m%d-%H%M%S}-{sha256_bytes((artifact.sha256 + card_hash).encode())[:6]}"
    run_dir = req.out_root / run_id
    (run_dir / "rater_outputs").mkdir(parents=True, exist_ok=True)
    (run_dir / "prompts").mkdir(exist_ok=True)
    shutil.copyfile(req.scorecard_path, run_dir / f"scorecard.frozen{req.scorecard_path.suffix.lower()}")

    notes: list[str] = []
    llm_dims = card.by_kind("llm")
    raters_cfg = cfg["raters"]
    cons_cfg = cfg["consolidator"]
    if llm_dims and (note := family_note(raters_cfg)):
        notes.append(note)
    models_used = [r["model"] for r in raters_cfg]
    if len(set(models_used)) < len(models_used):
        notes.append("Two raters use the same model, so they are not independent. Give each rater a different model.")

    # ------------------------------------------------------------------ confidentiality
    if llm_dims and not req.mock and not req.assume_yes:
        if not confirm(external_notice(cfg, raters_cfg, cons_cfg, len(sources))):
            raise InputError("Cancelled: nothing was sent.")

    # ------------------------------------------------------------------ deterministic dimensions
    stage("Running the deterministic checks")
    workbook = ArtifactWorkbook.load(artifact.path) if artifact.kind == "xlsx" else None
    final_dims: dict[str, FinalDim] = {}
    findings: list[FinalFinding] = []
    code_log: dict[str, list[dict]] = {}
    for dim in card.by_kind("code"):
        base = dict(id=dim.id, name=dim.name, group=dim.group, weight=dim.weight, critical=dim.critical, evaluator="code")
        if workbook is None:
            final_dims[dim.id] = FinalDim(**base, status="not_measurable", score=None,
                                          detail=["The artifact is not a workbook with Tree, Schema register and Allowed values sheets, so the code checks could not run."])
            continue
        score, results = run_code_dimension(workbook, dim)
        detail = []
        for r in results:
            detail.append(r.summary())
            detail.extend(f"  - {v}" for v in r.violations[:5])
        final_dims[dim.id] = FinalDim(**base, score=score, spread=None, basis="code", detail=detail)
        findings.extend(_code_findings(results, dim.id, dim.name))
        code_log[dim.id] = [{"id": r.id, "name": r.name, "severity": r.severity, "total": r.total,
                             "violations": r.violations} for r in results]
    (run_dir / "code_checks.json").write_text(json.dumps(code_log, indent=2), encoding="utf-8")

    # ------------------------------------------------------------------ raters + consolidator
    rater_runs: list[RaterRun] = []
    validated: list[ValidatedRater] = []
    cons_run = None
    stats: dict[str, DimStats] = {}
    strengths: list[FinalStrength] = []
    llm_names = {d.id: d.name for d in llm_dims}
    corpus = artifact.text + "\n" + "\n".join(s.text for s in sources)
    corpus_norm = normalise(corpus)

    if llm_dims:
        default_provider = cfg.get("provider", "gemini")
        used = sorted({s.get("provider", default_provider) for s in raters_cfg + [cons_cfg]})
        providers = build_providers(cfg, mock=req.mock, only=used)
        expected_ids = [d.id for d in llm_dims]
        system, user = build_rater_prompt(card, llm_dims, artifact, sources)
        (run_dir / "prompts" / "rater_system.txt").write_text(system, encoding="utf-8")
        (run_dir / "prompts" / "rater_user.txt").write_text(user, encoding="utf-8")
        stage(f"Three raters are scoring {len(llm_dims)} dimensions"
              + ("" if cfg.get("parallel_raters", True) else " (one after another)"))
        rater_runs = run_raters(providers, raters_cfg, system, user, expected_ids,
                                parallel=bool(cfg.get("parallel_raters", True)))
        for rr in rater_runs:
            (run_dir / "rater_outputs" / f"rater_{rr.rater_id}_raw.txt").write_text(rr.raw or rr.error, encoding="utf-8")
            if not rr.ok:
                notes.append(f"Rater {rr.rater_id} produced no usable result: {rr.error}")
                continue
            if rr.error:
                notes.append(f"Rater {rr.rater_id} gave a partial result ({rr.error}).")
            validated.append(validate_rater(rr.rater_id, rr.result.dimensions, llm_dims, corpus))
        if len(validated) < 2:
            notes.append(f"Only {len(validated)} of {len(raters_cfg)} raters gave a result. Confidence is low; agreement cannot be judged.")

        if validated:
            stage("The consolidator is reconciling the three results")
            cons_run, stats = consolidate(providers, cons_cfg, card, llm_dims, artifact, sources, validated)
            (run_dir / "rater_outputs" / "consolidator_raw.txt").write_text(cons_run.raw or cons_run.error, encoding="utf-8")
            notes.extend(f"Guardrail: {n}" for n in cons_run.guardrail_notes)
            if cons_run.result is None:
                notes.append(f"The consolidator failed ({cons_run.error}); the lowest usable rater score stands for each dimension.")
                cons_result = _fallback_consolidation(stats, validated)
            else:
                cons_result = cons_run.result
        else:
            stats = dimension_stats([], llm_dims)
            cons_result = ConsolidatorResult(dimensions=[ConsDim(dimension_id=d.id, not_measurable=True, flagged_for_person=True,
                                                                 rationale="No rater result.") for d in llm_dims])

        cons_by_id = {c.dimension_id: c for c in cons_result.dimensions}
        all_rater_ids = [r["id"] for r in raters_cfg]
        for dim in llm_dims:
            st = stats[dim.id]
            c = cons_by_id.get(dim.id)
            base = dict(id=dim.id, name=dim.name, group=dim.group, weight=dim.weight, critical=dim.critical, evaluator="llm")
            rater_scores = {rid: st.scores.get(rid) for rid in all_rater_ids}
            if c is None or c.score is None:
                final_dims[dim.id] = FinalDim(**base, status="not_measurable", rater_scores=rater_scores, spread=st.spread,
                                              rationale=(c.rationale if c else "No consolidated score."),
                                              flagged_for_person=True, detail=["Could not be scored from evidence."])
            else:
                final_dims[dim.id] = FinalDim(**base, score=c.score, rater_scores=rater_scores, spread=st.spread,
                                              basis=c.basis, rationale=c.rationale, flagged_for_person=c.flagged_for_person)

        dropped_findings = dropped_strengths = 0
        for f in cons_result.findings:
            if f.dimension_id not in llm_names:
                dropped_findings += 1
                continue
            verified = f.absence or quote_found(f.quote, corpus_norm)
            sev = f.severity
            if not verified and sev == "HIGH":
                sev = "MEDIUM"
            elif not verified and sev == "MEDIUM":
                sev = "LOW"
            findings.append(FinalFinding(
                id="", severity=sev, dimension_id=f.dimension_id, dimension_name=llm_names[f.dimension_id],
                text=f.text, location=f.location, quote=f.quote, fix=f.fix, return_to=f.return_to,
                raised_by=f.raised_by, verified=verified, origin="rater",
            ))
        for s in cons_result.strengths:
            if s.dimension_id in llm_names and quote_found(s.quote, corpus_norm):
                strengths.append(FinalStrength(dimension_id=s.dimension_id, dimension_name=llm_names[s.dimension_id],
                                               text=s.text, location=s.location, quote=s.quote))
            else:
                dropped_strengths += 1
        if dropped_findings:
            notes.append(f"{dropped_findings} finding(s) named an unknown dimension and were dropped.")
        if dropped_strengths:
            notes.append(f"{dropped_strengths} strength(s) were dropped because their quote could not be verified.")

    # ------------------------------------------------------------------ human dimensions
    for dim in card.by_kind("human"):
        base = dict(id=dim.id, name=dim.name, group=dim.group, weight=dim.weight, critical=dim.critical, evaluator="human")
        ev = human.get(dim.id)
        if ev:
            final_dims[dim.id] = FinalDim(**base, score=ev["score"], basis="human",
                                          detail=[f"Supplied by {ev['by']}. {ev['note']}".strip()])
        else:
            final_dims[dim.id] = FinalDim(**base, status="pending_human", score=None,
                                          detail=["Waiting for a person. Supply it with --human-evidence."])

    # ------------------------------------------------------------------ order, id, decide
    stage("Deciding the verdict and writing the report")
    findings.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.dimension_id, f.text))
    for i, f in enumerate(findings, start=1):
        f.id = f"F-{i:03d}"
    ordered = [final_dims[d.id] for d in card.dimensions]
    decision = decide(card, ordered, findings)
    steps = path_to_green(card, ordered, findings, decision)

    # ------------------------------------------------------------------ freeze check
    changed = [name for name, path, expected in (
        [("artifact", artifact.path, artifact.sha256), ("scorecard", req.scorecard_path, card_file_hash)]
        + [(f"source {s.path.name}", s.path, s.sha256) for s in sources]
    ) if sha256_file(path) != expected]
    if changed:
        raise InputError(f"Input changed during the run: {', '.join(changed)}. The run is invalid; nothing was reported.")

    # ------------------------------------------------------------------ assemble the report
    agreement_rows = []
    for d in ordered:
        if d.evaluator != "llm" or d.score is None and not d.flagged_for_person:
            continue
        agreement_rows.append({"dimension_id": d.id, "name": d.name, "rater_scores": d.rater_scores, "score": d.score,
                               "basis": d.basis or "n/a", "rationale": d.rationale, "flagged": d.flagged_for_person,
                               "spread": d.spread})
    spreads = [r["spread"] for r in agreement_rows if r["spread"] is not None]
    agreement = {
        "raters_total": len(raters_cfg) if llm_dims else 0,
        "raters_ok": len(validated),
        "average_spread": round(sum(spreads) / len(spreads), 2) if spreads else None,
        "disagreements": [r for r in agreement_rows if r["spread"] is not None and r["spread"] > 1],
        "flagged_for_person": [r for r in agreement_rows if r["flagged"]],
        "per_rater": [{"id": v.rater_id, "discarded_scores": len(v.discarded_scores),
                       "discarded_evidence": v.discarded_evidence, "missing": v.missing} for v in validated],
        "notes": notes,
    }
    not_measurable = []
    for d in ordered:
        if d.score is not None:
            continue
        why = ("Only a person can supply this. Provide it with --human-evidence." if d.evaluator == "human"
               else (d.detail[0] if d.evaluator == "code" and d.detail else "The raters could not score it from the evidence."))
        not_measurable.append({"dimension_id": d.id, "name": d.name, "kind": d.evaluator, "weight": d.weight,
                               "critical": d.critical, "why": why})

    artifact_id = req.artifact_id or artifact.path.stem
    version = req.artifact_version or detect_version(artifact.text, artifact.path)
    rep = {
        "schema": report_mod.SCHEMA,
        "header": {
            "run_id": run_id, "date": _now().isoformat(timespec="seconds"), "mock": req.mock,
            "artifact": {"id": artifact_id, "version": version, "label": artifact.label, "sha256": artifact.sha256},
            "scorecard": {"id": card.id, "version": card.version, "sha256": card_hash},
            "sources": [{"label": s.label, "sha256": s.sha256} for s in sources],
            "raters": [{"id": rr.rater_id, "family": rr.family, "model": rr.model, "model_version": rr.model_version,
                        "ok": rr.ok, "error": rr.error if not rr.ok else ""} for rr in rater_runs],
            "consolidator": {"model": cons_cfg["model"], "model_version": cons_run.model_version if cons_run else "",
                             "error": cons_run.error if cons_run else ""},
        },
        "verdict": {
            "decision": decision.verdict, "final": decision.final, "weighted_score": decision.weighted_score,
            "measured_weight": decision.measured_weight, "open_high_findings": decision.open_high_findings,
            "thresholds": card.thresholds.model_dump(), "reasons": decision.reasons,
            "critical_gates": [{"dimension_id": g.dimension_id, "name": g.name, "score": g.score, "result": g.result}
                               for g in decision.gates],
        },
        "dimension_scores": [d.model_dump() for d in ordered],
        "strengths": [s.model_dump() for s in strengths],
        "findings": [f.model_dump() for f in findings],
        "rater_agreement": agreement,
        "not_measurable_here": not_measurable,
        "path_to_green": [s.__dict__ for s in steps],
    }

    (run_dir / "report.json").write_text(report_mod.to_json(rep), encoding="utf-8")
    (run_dir / "report.html").write_text(report_mod.render_html(rep), encoding="utf-8")
    (run_dir / "report.md").write_text(report_mod.render_md(rep), encoding="utf-8")
    usage = [{"role": f"rater {r.rater_id}", "model": r.model, "attempts": r.attempts, "elapsed_s": round(r.elapsed_s, 1),
              "prompt_tokens": r.prompt_tokens, "completion_tokens": r.completion_tokens} for r in rater_runs]
    if cons_run:
        usage.append({"role": "consolidator", "model": cons_run.model, "attempts": cons_run.attempts,
                      "elapsed_s": round(cons_run.elapsed_s, 1), "prompt_tokens": cons_run.prompt_tokens,
                      "completion_tokens": cons_run.completion_tokens})
    (run_dir / "meta.json").write_text(json.dumps({
        "run_id": run_id, "mock": req.mock, "config": cfg,
        "inputs": {"artifact": artifact.sha256, "scorecard": card_hash,
                   "sources": {s.label: s.sha256 for s in sources}, "human_evidence": human},
        "calls": usage,
    }, indent=2, default=str), encoding="utf-8")
    return rep, run_dir
