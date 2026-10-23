import json

import pytest
import yaml

from ddd_evaluator.cli import main
from ddd_evaluator.loader import InputError
from ddd_evaluator.pipeline import EvalRequest, run_evaluation
from conftest import SCORECARD

SECTIONS = ["header", "verdict", "dimension_scores", "strengths", "findings", "rater_agreement",
            "not_measurable_here", "path_to_green"]


def request(workbook, docket, config_file, tmp_path, **kw):
    return EvalRequest(artifact_spec=str(workbook), scorecard_path=SCORECARD, source_specs=[str(docket)],
                       config_path=config_file, out_root=tmp_path / "runs", mock=True, **kw)


def test_mock_run_writes_the_eight_sections_and_all_outputs(workbook, docket, config_file, tmp_path):
    rep, run_dir = run_evaluation(request(workbook, docket, config_file, tmp_path))
    for key in SECTIONS:
        assert key in rep
    assert rep["header"]["mock"] is True
    assert rep["verdict"]["decision"] in {"GREEN", "AMBER", "RED"}
    assert len(rep["dimension_scores"]) == 19
    for name in ("report.json", "report.html", "report.md", "meta.json", "code_checks.json", "scorecard.frozen.xlsx"):
        assert (run_dir / name).is_file(), name
    assert (run_dir / "rater_outputs" / "rater_A_raw.txt").is_file()
    assert (run_dir / "prompts" / "rater_user.txt").is_file()
    assert json.loads((run_dir / "report.json").read_text(encoding="utf-8"))["schema"] == "evaluation-report/1.0"


def test_html_has_every_section_and_colour_codes(workbook, docket, config_file, tmp_path):
    rep, run_dir = run_evaluation(request(workbook, docket, config_file, tmp_path))
    page = (run_dir / "report.html").read_text(encoding="utf-8")
    for title in ("Header", "Verdict", "Dimension scores", "Strengths", "Gaps and findings", "Rater agreement",
                  "Not measurable here", "Path to green"):
        assert title in page
    assert "MOCK RUN" in page
    assert "banner " + {"GREEN": "green", "AMBER": "amber", "RED": "red"}[rep["verdict"]["decision"]] in page
    assert "chip green" in page or "chip amber" in page or "chip red" in page


def test_human_dimensions_stay_pending_until_evidence_is_supplied(workbook, docket, config_file, tmp_path):
    rep, _ = run_evaluation(request(workbook, docket, config_file, tmp_path))
    h = {d["id"]: d for d in rep["dimension_scores"] if d["evaluator"] == "human"}
    assert all(d["score"] is None and d["status"] == "pending_human" for d in h.values())
    assert {n["dimension_id"] for n in rep["not_measurable_here"]} >= {"H01", "H02"}

    ev = tmp_path / "human.yaml"
    ev.write_text(yaml.safe_dump({"H01": {"score": 4, "by": "Mentor", "note": "interview"},
                                  "H02": {"score": 5, "by": "Peer", "note": "signed"}}), encoding="utf-8")
    rep2, _ = run_evaluation(request(workbook, docket, config_file, tmp_path, human_path=ev))
    h2 = {d["id"]: d for d in rep2["dimension_scores"] if d["evaluator"] == "human"}
    assert h2["H01"]["score"] == 4 and "Mentor" in h2["H01"]["detail"][0]
    assert rep2["verdict"]["final"] is True


def test_human_evidence_needs_a_name(workbook, docket, config_file, tmp_path):
    ev = tmp_path / "human.yaml"
    ev.write_text(yaml.safe_dump({"H01": {"score": 4}}), encoding="utf-8")
    with pytest.raises(InputError, match="by"):
        run_evaluation(request(workbook, docket, config_file, tmp_path, human_path=ev))


def test_code_findings_appear_for_a_broken_workbook(broken_workbook, docket, config_file, tmp_path):
    rep, _ = run_evaluation(request(broken_workbook, docket, config_file, tmp_path))
    code = [f for f in rep["findings"] if f["origin"] == "code"]
    assert any("K10" in f["text"] for f in code)
    d03 = next(d for d in rep["dimension_scores"] if d["id"] == "D03")
    assert d03["score"] <= 3  # a HIGH check failed, so the dimension is capped
    gate = next(g for g in rep["verdict"]["critical_gates"] if g["dimension_id"] == "D03")
    assert gate["result"] == "FAIL"


def test_non_workbook_artifact_makes_code_dimensions_not_measurable(tmp_path, docket, config_file):
    art = tmp_path / "schema.sql"
    art.write_text("CREATE TABLE thing (id bigint primary key, kind text not null);\n", encoding="utf-8")
    rep, _ = run_evaluation(request(art, docket, config_file, tmp_path))
    code = [d for d in rep["dimension_scores"] if d["evaluator"] == "code"]
    assert all(d["status"] == "not_measurable" for d in code)


def test_input_changed_during_the_run_is_caught(workbook, docket, config_file, tmp_path, monkeypatch):
    import ddd_evaluator.pipeline as pl

    original = pl.run_raters

    def tamper(*a, **k):
        docket.write_text("changed mid-run", encoding="utf-8")
        return original(*a, **k)

    monkeypatch.setattr(pl, "run_raters", tamper)
    with pytest.raises(InputError, match="changed during the run"):
        run_evaluation(request(workbook, docket, config_file, tmp_path))


def test_cli_exit_codes_and_missing_file(workbook, docket, config_file, tmp_path, capsys):
    code = main(["evaluate", "--artifact", str(workbook), "--scorecard", str(SCORECARD), "--source", str(docket),
                 "--config", str(config_file), "--out", str(tmp_path / "r"), "--mock"])
    assert code in (0, 10, 20)
    assert "weighted score" in capsys.readouterr().out
    bad = main(["evaluate", "--artifact", str(tmp_path / "missing.xlsx"), "--scorecard", str(SCORECARD),
                "--config", str(config_file), "--out", str(tmp_path / "r"), "--mock"])
    assert bad == 2
