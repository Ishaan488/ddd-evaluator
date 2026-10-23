from ddd_evaluator.decision import decide, path_to_green, weighted_score
from ddd_evaluator.loader import load_scorecard
from ddd_evaluator.models import FinalDim, FinalFinding
from conftest import SCORECARD

CARD, _ = load_scorecard(SCORECARD)


def dims(score_for, human=None):
    """Build FinalDims for the real scorecard. score_for(dim) -> int | None."""
    out = []
    for d in CARD.dimensions:
        s = score_for(d)
        if d.evaluator == "human":
            s = (human or {}).get(d.id)
        out.append(FinalDim(id=d.id, name=d.name, group=d.group, weight=d.weight, critical=d.critical, evaluator=d.evaluator,
                            score=s, status="scored" if s is not None else "pending_human"))
    return out


def high(dim_id="L01"):
    return FinalFinding(id="F-001", severity="HIGH", dimension_id=dim_id, dimension_name="x", text="bad", fix="fix it")


def test_weighted_score_ignores_unscored_weight():
    ds = dims(lambda d: 5)
    assert weighted_score(ds) == (100.0, 86.0)  # human 14 not scored
    ds = dims(lambda d: 4)
    assert weighted_score(ds)[0] == 80.0


def test_green_is_provisional_until_human_evidence_arrives():
    d = decide(CARD, dims(lambda d: 5), [])
    assert (d.verdict, d.final) == ("GREEN", False)
    assert {g.result for g in d.gates if g.dimension_id == "H01"} == {"PENDING"}
    d = decide(CARD, dims(lambda d: 5, human={"H01": 5, "H02": 5}), [])
    assert (d.verdict, d.final) == ("GREEN", True)


def test_critical_gate_below_4_forces_amber_even_with_high_score():
    d = decide(CARD, dims(lambda d: 3 if d.id == "L02" else 5, human={"H01": 5, "H02": 5}), [])
    assert d.verdict == "AMBER"
    assert [g.dimension_id for g in d.gates if g.result == "FAIL"] == ["L02"]


def test_high_finding_blocks_green():
    d = decide(CARD, dims(lambda d: 5, human={"H01": 5, "H02": 5}), [high()])
    assert d.verdict == "AMBER" and d.open_high_findings == 1


def test_below_75_is_red_and_75_to_89_is_amber():
    assert decide(CARD, dims(lambda d: 3, human={"H01": 3, "H02": 3}), []).verdict == "RED"  # 60
    assert decide(CARD, dims(lambda d: 4, human={"H01": 4, "H02": 4}), []).verdict == "AMBER"  # 80


def test_path_to_green_lists_blockers_first_and_reaches_the_target():
    ds = dims(lambda d: 3 if d.id in ("L02", "L06", "L07") else 5, human={"H01": 5, "H02": 5})
    findings = [high("L06")]
    decision = decide(CARD, ds, findings)
    steps = path_to_green(CARD, ds, findings, decision)
    assert steps[0].dimensions == ["L06"]  # the HIGH finding comes first
    assert any(s.dimensions == ["L02"] for s in steps)  # the failed critical gate is in the path
    assert steps[-1].projected_score >= CARD.thresholds.green
