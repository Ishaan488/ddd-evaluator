from ddd_evaluator.consolidator import ConsolidationRun, DimStats, _apply_guardrails
from ddd_evaluator.llm import extract_json
from ddd_evaluator.loader import load_scorecard
from ddd_evaluator.models import ConsDim, ConsolidatorResult, DimScore, Evidence, Finding
from ddd_evaluator.validator import normalise, quote_found, validate_rater
from conftest import SCORECARD

CARD, _ = load_scorecard(SCORECARD)
L01 = CARD.get("L01")
CORPUS = "R4: Study id | One short code for this study. | id | atomic | required | unique, pattern FDS-nn"


def test_quote_matching_is_forgiving_about_case_quotes_and_ellipsis():
    n = normalise(CORPUS)
    assert quote_found("one short CODE for this study", n)
    assert quote_found("Study id ... pattern FDS-nn", n)
    assert not quote_found("a quote the model invented", n)
    assert not quote_found("id", n)  # too short to count


def test_score_with_only_invented_evidence_is_discarded():
    raw = DimScore(dimension_id="L01", score=4, evidence=[Evidence(location="x", quote="this text is nowhere in the artifact")])
    v = validate_rater("A", [raw], [L01], CORPUS)
    assert v.dims["L01"].score is None
    assert v.discarded_scores == ["L01"] and v.discarded_evidence == 1


def test_valid_quote_keeps_the_score_and_low_score_may_rest_on_absence():
    good = DimScore(dimension_id="L01", score=4, evidence=[Evidence(location="Tree 1.1.1", quote="One short code for this study")])
    v = validate_rater("A", [good], [L01], CORPUS)
    assert v.dims["L01"].score == 4
    absent = DimScore(dimension_id="L01", score=1, rationale="No definitions at all are given.")
    assert validate_rater("A", [absent], [L01], CORPUS).dims["L01"].score == 1


def test_unverified_high_finding_is_downgraded_but_absence_is_allowed():
    raw = DimScore(dimension_id="L01", score=3, evidence=[Evidence(quote="One short code for this study")], findings=[
        Finding(severity="HIGH", text="invented", quote="not in the text anywhere"),
        Finding(severity="HIGH", text="nothing records the workflow", absence=True),
    ])
    f = validate_rater("A", [raw], [L01], CORPUS).dims["L01"].findings
    assert [x.severity for x in f] == ["MEDIUM", "HIGH"]


def test_consolidator_cannot_score_outside_the_rater_range():
    run = ConsolidationRun(result=ConsolidatorResult(dimensions=[ConsDim(dimension_id="L01", score=5, basis="agreed")]))
    stats = {"L01": DimStats(scores={"A": 2, "B": 3, "C": 3}, low=2, high=3, spread=1, usable=3)}
    _apply_guardrails(run, [L01], stats)
    d = run.result.dimensions[0]
    assert d.score == 2 and d.flagged_for_person and run.guardrail_notes


def test_lower_score_stands_when_unresolved_and_single_rater_is_flagged():
    run = ConsolidationRun(result=ConsolidatorResult(dimensions=[ConsDim(dimension_id="L01", score=3, basis="lower_stands")]))
    stats = {"L01": DimStats(scores={"A": 1, "B": 4, "C": 5}, low=1, high=5, spread=4, usable=3)}
    _apply_guardrails(run, [L01], stats)
    assert run.result.dimensions[0].score == 1
    run = ConsolidationRun(result=ConsolidatorResult(dimensions=[ConsDim(dimension_id="L01", score=4)]))
    stats = {"L01": DimStats(scores={"A": 4, "B": None, "C": None}, low=4, high=4, spread=0, usable=1)}
    _apply_guardrails(run, [L01], stats)
    assert run.result.dimensions[0].basis == "single_rater" and run.result.dimensions[0].flagged_for_person


def test_no_usable_rater_means_not_measurable():
    run = ConsolidationRun(result=ConsolidatorResult(dimensions=[ConsDim(dimension_id="L01", score=4)]))
    stats = {"L01": DimStats(scores={"A": None, "B": None, "C": None}, low=None, high=None, spread=None, usable=0)}
    _apply_guardrails(run, [L01], stats)
    assert run.result.dimensions[0].score is None


def test_extract_json_handles_fences_and_chatter():
    assert extract_json('Sure!\n```json\n{"a": {"b": "}"}}\n```\nDone.') == {"a": {"b": "}"}}
    assert extract_json('prefix {"x": 1} suffix') == {"x": 1}
