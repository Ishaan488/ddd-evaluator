"""The decision engine. Pure code: the weighted score, the critical gates and the verdict."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .models import FinalDim, FinalFinding, GateResult, Scorecard, Verdict


@dataclass
class Gate:
    dimension_id: str
    name: str
    score: Optional[int]
    result: GateResult


@dataclass
class Decision:
    weighted_score: float  # 0 to 100, over the dimensions that could be scored
    measured_weight: float  # weight (out of 100) that was scored
    verdict: Verdict
    final: bool  # false while a critical or human-only gate is still pending
    gates: list[Gate]
    pending: list[str]  # human-only or unmeasurable dimensions still to supply
    reasons: list[str]
    open_high_findings: int = 0


def weighted_score(dims: list[FinalDim]) -> tuple[float, float]:
    scored = [d for d in dims if d.score is not None]
    weight = sum(d.weight for d in scored)
    if weight == 0:
        return 0.0, 0.0
    points = sum(d.weight * d.score / 5 for d in scored)
    return round(100 * points / weight, 1), round(weight, 1)


def decide(card: Scorecard, dims: list[FinalDim], findings: list[FinalFinding]) -> Decision:
    t = card.thresholds
    score, measured = weighted_score(dims)

    gates: list[Gate] = []
    for d in dims:
        if not d.critical:
            continue
        if d.score is None:
            gates.append(Gate(d.id, d.name, None, "PENDING"))
        else:
            gates.append(Gate(d.id, d.name, d.score, "PASS" if d.score >= t.critical_min else "FAIL"))
    failed = [g for g in gates if g.result == "FAIL"]
    pending = [f"{d.id} {d.name}" for d in dims if d.score is None]
    high = sum(1 for f in findings if f.severity == "HIGH")

    reasons: list[str] = []
    if score < t.amber:
        verdict: Verdict = "RED"
        reasons.append(f"Weighted score {score} is below {t.amber:g}.")
    elif score >= t.green and not failed and high == 0:
        verdict = "GREEN"
        reasons.append(f"Weighted score {score} is at least {t.green:g}, every scored critical gate passed and no HIGH finding is open.")
    else:
        verdict = "AMBER"
        if score < t.green:
            reasons.append(f"Weighted score {score} is between {t.amber:g} and {t.green:g}.")
        if failed:
            reasons.append("Critical gate below " + str(t.critical_min) + ": " + ", ".join(f"{g.dimension_id} ({g.score})" for g in failed) + ".")
        if high:
            reasons.append(f"{high} HIGH finding(s) are open; a HIGH finding blocks green.")

    final = not pending
    if pending:
        reasons.append("Not yet scored (needs a person or could not be measured): " + "; ".join(pending) + ".")
        if verdict == "GREEN":
            reasons.append("The result is a provisional GREEN: it cannot be final until that evidence is supplied.")
    return Decision(score, measured, verdict, final, gates, pending, reasons, high)


# --------------------------------------------------------------------------- path to green
@dataclass
class PathStep:
    priority: int
    action: str
    dimensions: list[str]
    finding_ids: list[str]
    target_score: int
    projected_score: float


def path_to_green(card: Scorecard, dims: list[FinalDim], findings: list[FinalFinding], decision: Decision) -> list[PathStep]:
    """The smallest set of fixes, in priority order, that would change the verdict. An estimate:
    it assumes each fix lifts its dimension to the stated target score."""
    t = card.thresholds
    steps: list[PathStep] = []
    scores = {d.id: d.score for d in dims}
    weights = {d.id: d.weight for d in dims}
    names = {d.id: d.name for d in dims}
    critical = {d.id for d in dims if d.critical}
    measured_ids = [i for i, s in scores.items() if s is not None]
    total_w = sum(weights[i] for i in measured_ids) or 1.0

    def projected() -> float:
        return round(100 * sum(weights[i] * scores[i] / 5 for i in measured_ids) / total_w, 1)

    def fixes_for(dim_id: str, only_high: bool = False) -> tuple[list[str], list[str]]:
        picked = [f for f in findings if f.dimension_id == dim_id and (not only_high or f.severity == "HIGH")]
        picked.sort(key=lambda f: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}[f.severity])
        return [f.fix or f.text for f in picked[:3]], [f.id for f in picked]

    done: set[str] = set()

    def add(dim_id: str, target: int, why: str) -> None:
        if dim_id in done or scores.get(dim_id) is None or scores[dim_id] >= target:
            return
        texts, ids = fixes_for(dim_id)
        scores[dim_id] = target
        done.add(dim_id)
        action = f"{why} {names[dim_id]} ({dim_id}): " + ("; ".join(texts) if texts else f"raise the dimension to {target} by meeting its anchor.")
        steps.append(PathStep(len(steps) + 1, action, [dim_id], ids, target, projected()))

    # 1. HIGH findings block green wherever they sit.
    for dim_id in dict.fromkeys(f.dimension_id for f in findings if f.severity == "HIGH"):
        if scores.get(dim_id) is not None:
            target = min(5, max(scores[dim_id] + 1, t.critical_min if dim_id in critical else 4))
            add(dim_id, target, "Clear the HIGH finding in")
        else:
            texts, ids = fixes_for(dim_id, only_high=True)
            if texts:
                steps.append(PathStep(len(steps) + 1, f"Clear the HIGH finding in {dim_id}: " + "; ".join(texts), [dim_id], ids, 0, projected()))
    # 2. Critical gates below the minimum.
    for d in dims:
        if d.id in critical and d.score is not None and d.score < t.critical_min:
            add(d.id, t.critical_min, "Pass the critical gate:")
    # 3. Biggest remaining gains until the score reaches green.
    if projected() < t.green:
        gains = sorted(
            ((weights[i] * (5 - scores[i]) / 5, i) for i in measured_ids if scores[i] < 5 and i not in done),
            reverse=True,
        )
        for _, dim_id in gains:
            if projected() >= t.green:
                break
            add(dim_id, 5, "Raise")
    # 4. Evidence only a person can supply.
    for item in decision.pending:
        dim_id = item.split()[0]
        steps.append(PathStep(len(steps) + 1, f"Supply the missing evidence for {item} (a person must provide it).",
                              [dim_id], [], 0, projected()))
    return steps
