import time

import pytest
from fastapi.testclient import TestClient

from ddd_evaluator.web.app import create_app
from conftest import SCORECARD, edit_scorecard


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY_WEBTEST", raising=False)
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        "provider: gemini\nproviders:\n  gemini: {type: gemini, api_key_env: GEMINI_API_KEY_WEBTEST}\n"
        "raters:\n  - {id: A, family: google, model: m1}\n  - {id: B, family: google, model: m2}\n  - {id: C, family: google, model: m3}\n"
        "consolidator: {model: m1}\n", encoding="utf-8")
    return TestClient(create_app(cfg, tmp_path / "runs"))


def upload_card(client, path=SCORECARD):
    with open(path, "rb") as f:
        return client.post("/api/scorecard", files={"scorecard": (path.name, f, "application/octet-stream")})


def test_page_and_status_show_no_scorecard_until_one_is_uploaded(client):
    page = client.get("/")
    assert page.status_code == 200 and "DDD Evaluator" in page.text
    s = client.get("/api/status").json()
    assert "scorecards" not in s
    assert s["key_ready"] is False and s["keys"] == {"gemini": False}
    assert "one model family" in s["family_note"] and "free tier" in s["external_notice"]
    assert client.get("/api/scorecard/SC-DISCOVER-D2.xlsx").status_code in (404, 405)  # no default scorecard route


def test_uploaded_scorecard_is_parsed_and_shown(client):
    r = upload_card(client)
    assert r.status_code == 200
    c = r.json()
    assert c["id"] == "SC-DISCOVER-D2" and c["frozen"] is True and len(c["scorecard_id"]) == 12
    assert len(c["dimensions"]) == 19 and c["weights"] == {"code": 20, "llm": 66, "human": 14}
    assert all(set(d["anchors"]) == {"0", "1", "2", "3", "4", "5"} for d in c["dimensions"])


def test_bad_scorecard_returns_every_problem(client, tmp_path):
    bad = edit_scorecard(tmp_path, lambda wb: wb["Dimensions"].cell(row=2, column=4).__setattr__("value", "x"))
    r = upload_card(client, bad)
    assert r.status_code == 400
    body = r.json()
    assert "problems" in body and any("Weight must be a number" in p for p in body["problems"])


def test_scorecard_upload_must_be_excel(client, tmp_path):
    p = tmp_path / "card.yaml"
    p.write_text("x: 1")
    r = upload_card(client, p)
    assert r.status_code == 400 and "Excel" in r.json()["detail"]


def test_template_download_is_a_valid_workbook(client, tmp_path):
    r = client.get("/api/scorecard-template")
    assert r.status_code == 200 and r.content[:2] == b"PK"
    out = tmp_path / "t.xlsx"
    out.write_bytes(r.content)
    from ddd_evaluator.scorecard_io import read_scorecard
    assert read_scorecard(out).id == "SC-EXAMPLE"


def wait(client, job_id, seconds=30):
    end = time.time() + seconds
    while time.time() < end:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def post(client, workbook, docket, card_id, **form):
    data = {"scorecard_id": card_id, "mock": "true", **form}
    with open(workbook, "rb") as a, open(docket, "rb") as d:
        files = [("artifact", (workbook.name, a, "application/octet-stream")), ("sources", (docket.name, d, "text/markdown"))]
        return client.post("/api/evaluate", data=data, files=files)


def test_dry_run_end_to_end_and_report_download(client, workbook, docket):
    card_id = upload_card(client).json()["scorecard_id"]
    r = post(client, workbook, docket, card_id)
    assert r.status_code == 200
    job = wait(client, r.json()["job_id"])
    assert job["status"] == "done", job
    res = job["result"]
    assert res["decision"] in {"GREEN", "AMBER", "RED"} and res["mock"] is True
    assert job["stages"][0]["text"].startswith("Loading") and job["stages"][-1]["text"] == "Done"
    html = client.get(f"/api/runs/{res['run_id']}/html")
    assert html.status_code == 200 and "Dimension scores" in html.text
    assert "default-src 'none'" in html.headers["content-security-policy"]
    dl = client.get(f"/api/runs/{res['run_id']}/json?download=true")
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]


def test_unknown_or_unfrozen_scorecard_is_refused(client, workbook, docket, tmp_path):
    assert post(client, workbook, docket, "0" * 12).status_code == 404
    assert post(client, workbook, docket, "../../etc").status_code == 404

    def unfreeze(wb):
        for row in wb["Scorecard"].iter_rows(min_row=1, max_col=2):
            if row[0].value == "Frozen":
                row[1].value = "no"
    card_id = upload_card(client, edit_scorecard(tmp_path, unfreeze)).json()["scorecard_id"]
    r = post(client, workbook, docket, card_id)
    assert r.status_code == 400 and "not frozen" in r.json()["detail"]


def test_real_run_needs_a_key_and_consent(client, workbook, docket):
    card_id = upload_card(client).json()["scorecard_id"]
    r = post(client, workbook, docket, card_id, mock="false")
    assert r.status_code == 400 and "No API key" in r.json()["detail"]


def test_bad_uploads_are_refused(client, tmp_path, docket):
    card_id = upload_card(client).json()["scorecard_id"]
    exe = tmp_path / "evil.exe"
    exe.write_bytes(b"MZ")
    r = post(client, exe, docket, card_id)
    assert r.status_code == 400 and "not accepted" in r.json()["detail"]
    empty = tmp_path / "empty.md"
    empty.write_bytes(b"")
    assert post(client, empty, docket, card_id).status_code == 400


def test_report_paths_cannot_escape(client):
    assert client.get("/api/runs/..%2Fconfig/html").status_code == 404
    assert client.get("/api/runs/20260101-000000-abcdef/html").status_code == 404
    assert client.get("/api/runs/20260101-000000-abcdef/exe").status_code == 404
    assert client.get("/api/jobs/unknown").status_code == 404


def test_human_evidence_from_the_form_counts(client, workbook, docket):
    card_id = upload_card(client).json()["scorecard_id"]
    r = post(client, workbook, docket, card_id, h01_score="4", h01_by="Mentor", h01_note="interview",
             h02_score="5", h02_by="Peer", h02_note="signed")
    job = wait(client, r.json()["job_id"])
    assert job["status"] == "done" and job["result"]["final"] is True
