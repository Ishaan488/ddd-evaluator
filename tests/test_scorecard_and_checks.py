import pytest

from ddd_evaluator.checks import ArtifactWorkbook, CHECKS, band, score_code_dimension, CheckResult
from ddd_evaluator.loader import InputError, load_scorecard
from conftest import SCORECARD, edit_scorecard


def test_real_scorecard_loads_and_adds_up():
    card, digest = load_scorecard(SCORECARD)
    assert sum(d.weight for d in card.dimensions) == pytest.approx(100)
    assert len(digest) == 64
    kinds = {k: len(card.by_kind(k)) for k in ("code", "llm", "human")}
    assert kinds == {"code": 5, "llm": 12, "human": 2}
    assert all(c in CHECKS for d in card.by_kind("code") for c in d.checks)
    assert {d.id for d in card.dimensions if d.critical} == {"D01", "D03", "L02", "L03", "L04", "L05", "H01"}


def test_unfrozen_scorecard_is_refused(tmp_path):
    def unfreeze(wb):
        ws = wb["Scorecard"]
        for row in ws.iter_rows(min_row=1, max_col=2):
            if row[0].value == "Frozen":
                row[1].value = "no"

    p = edit_scorecard(tmp_path, unfreeze)
    with pytest.raises(InputError, match="not frozen"):
        load_scorecard(p)
    card, _ = load_scorecard(p, allow_unfrozen=True)
    assert card.frozen is False


def test_weights_must_add_up_to_100(tmp_path):
    p = edit_scorecard(tmp_path, lambda wb: wb["Dimensions"].cell(row=2, column=4).__setattr__("value", 6))
    with pytest.raises(InputError, match="weights add up to 101"):
        load_scorecard(p)


def test_yaml_scorecards_are_no_longer_accepted(tmp_path):
    p = tmp_path / "old.yaml"
    p.write_text("scorecard: {}")
    with pytest.raises(InputError, match="Excel"):
        load_scorecard(p)


def run_all(path):
    wb = ArtifactWorkbook.load(path)
    assert wb is not None
    return {cid: fn(wb) for cid, fn in CHECKS.items()}


def test_clean_workbook_passes_every_check(workbook):
    results = run_all(workbook)
    failing = {k: v.violations for k, v in results.items() if v.violations}
    assert failing == {}


def test_derived_from_parameter_is_not_mistaken_for_a_derived_column(workbook):
    # a parameter literally named "Derived from" must not trip K15
    assert run_all(workbook)["K15"].passed


def test_broken_workbook_is_caught(broken_workbook):
    r = run_all(broken_workbook)
    assert not r["K10"].passed and "part.thing_id" in r["K10"].violations[0]
    assert not r["K12"].passed and "thing.amount" in r["K12"].violations[0]
    assert not r["K20"].passed and "thing.tags" in r["K20"].violations[0]
    assert not r["K03"].passed  # the planted node with no definition


def test_non_workbook_gives_none(tmp_path):
    p = tmp_path / "x.md"
    p.write_text("hello")
    assert ArtifactWorkbook.load(p) is None


def test_band_and_caps():
    assert [band(x) for x in (1, 0.99, 0.95, 0.8, 0.3, 0)] == [5, 4, 3, 2, 1, 0]
    ok = CheckResult("K1", "n", "HIGH", 100, [], "")
    one_high = CheckResult("K2", "n", "HIGH", 1000, ["x"], "")
    one_med = CheckResult("K3", "n", "MEDIUM", 1000, ["x"], "")
    assert score_code_dimension([ok]) == 5
    assert score_code_dimension([ok, one_high]) == 3  # any HIGH violation caps at 3
    assert score_code_dimension([ok, one_med]) == 4  # any MEDIUM violation caps at 4
