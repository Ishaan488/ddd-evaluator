"""A small local web page: upload the schema, see the scorecard, run the evaluation, read the report.

Runs on this computer only (127.0.0.1). API keys stay in .env on the server and are never sent to the page.
"""
from __future__ import annotations

import re
import shutil
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Optional

import openpyxl
import yaml
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from ..llm import LLMError, provider_key_status
from ..loader import InputError, load_config, load_scorecard
from ..pipeline import EvalRequest, external_notice, family_note, run_evaluation
from ..scorecard_io import ScorecardFileError, content_hash, read_scorecard, write_template

CARD_ID = re.compile(r"^[0-9a-f]{12}$")
STATIC = Path(__file__).parent / "static"
ARTIFACT_SUFFIXES = {".xlsx", ".xlsm", ".md", ".txt", ".sql", ".json", ".yaml", ".yml", ".csv"}
SOURCE_SUFFIXES = ARTIFACT_SUFFIXES | {".pdf"}
MAX_BYTES = 30 * 1024 * 1024
RUN_ID = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{6}$")
WORKBOOK_SOURCE_SHEETS = ["Requirements", "NFR register"]
MAX_JOBS_KEPT = 50


def _safe_name(name: str) -> str:
    base = Path(name or "upload").name
    return re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:120] or "upload"


class Job:
    def __init__(self, job_id: str):
        self.id = job_id
        self.status = "queued"  # queued | running | done | error
        self.stages: list[dict] = []
        self.error = ""
        self.result: Optional[dict] = None
        self.started = time.time()

    def stage(self, text: str) -> None:
        self.stages.append({"text": text, "at": round(time.time() - self.started, 1)})

    def view(self) -> dict:
        return {"id": self.id, "status": self.status, "stages": self.stages, "error": self.error, "result": self.result,
                "elapsed": round(time.time() - self.started, 1)}


def create_app(config_path: Path = Path("config.yaml"), runs_dir: Path = Path("runs")) -> FastAPI:
    app = FastAPI(title="DDD Evaluator", docs_url=None, redoc_url=None)
    jobs: dict[str, Job] = {}
    lock = threading.Lock()
    card_dir = runs_dir / "_uploads" / "scorecards"

    def uploaded_scorecard(card_id: str) -> Path:
        if not CARD_ID.match(card_id):
            raise HTTPException(404, "Unknown scorecard. Upload it again.")
        found = sorted((card_dir / card_id).glob("*")) if (card_dir / card_id).is_dir() else []
        if not found:
            raise HTTPException(404, "Unknown scorecard. Upload it again.")
        return found[0]

    # ------------------------------------------------------------------ page and status
    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/api/status")
    def status():
        cfg = load_config(config_path)
        raters, cons = cfg["raters"], cfg["consolidator"]
        keys = provider_key_status(cfg)
        used = {s.get("provider", cfg.get("provider", "gemini")) for s in raters + [cons]}
        return {
            "keys": keys,
            "key_ready": all(keys.get(n, False) for n in used),
            "providers_needed": sorted(used),
            "raters": [{"id": r["id"], "family": r.get("family", ""), "model": r["model"]} for r in raters],
            "consolidator": {"model": cons["model"]},
            "family_note": family_note(raters),
            "external_notice": external_notice(cfg, raters, cons, 0).split("\n", 1)[1],
        }

    # ------------------------------------------------------------------ the scorecard comes from the user
    @app.post("/api/scorecard")
    async def upload_scorecard(scorecard: UploadFile = File(...)):
        name = _safe_name(scorecard.filename or "")
        if Path(name).suffix.lower() not in {".xlsx", ".xlsm"}:
            raise HTTPException(400, "The scorecard must be an Excel file (.xlsx). Download the template to start.")
        data = await scorecard.read(MAX_BYTES + 1)
        if not data or len(data) > MAX_BYTES:
            raise HTTPException(400, "The scorecard file is empty or too large.")
        card_id = uuid.uuid4().hex[:12]
        folder = card_dir / card_id
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        path.write_bytes(data)
        try:
            card = read_scorecard(path)
        except ScorecardFileError as exc:
            shutil.rmtree(folder, ignore_errors=True)
            return JSONResponse({"detail": "This scorecard has problems. Fix them and upload it again.",
                                 "problems": exc.problems}, status_code=400)
        out = card.model_dump()
        out.update(scorecard_id=card_id, file=name, sha256=content_hash(card),
                   counts={k: len(card.by_kind(k)) for k in ("code", "llm", "human")},
                   weights={k: sum(d.weight for d in card.by_kind(k)) for k in ("code", "llm", "human")})
        return out

    @app.get("/api/scorecard-template")
    def scorecard_template():
        folder = runs_dir / "_template"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / "scorecard-template.xlsx"
        write_template(path)
        return FileResponse(path, filename="scorecard-template.xlsx",
                            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    # ------------------------------------------------------------------ run an evaluation
    async def save_upload(up: UploadFile, folder: Path, allowed: set[str]) -> Path:
        name = _safe_name(up.filename or "")
        if Path(name).suffix.lower() not in allowed:
            raise HTTPException(400, f"{name}: file type not accepted. Use one of {', '.join(sorted(allowed))}.")
        data = await up.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(400, f"{name} is larger than {MAX_BYTES // (1024 * 1024)} MB.")
        if not data:
            raise HTTPException(400, f"{name} is empty.")
        dest = folder / name
        n = 1
        while dest.exists():
            dest = folder / f"{Path(name).stem}-{n}{Path(name).suffix}"
            n += 1
        dest.write_bytes(data)
        return dest

    @app.post("/api/evaluate")
    async def evaluate(
        artifact: UploadFile = File(...),
        sources: list[UploadFile] = File(default=[]),
        scorecard_id: str = Form(...),
        mock: bool = Form(False),
        confirm_external: bool = Form(False),
        use_workbook_sources: bool = Form(True),
        h01_score: Optional[int] = Form(None), h01_by: str = Form(""), h01_note: str = Form(""),
        h02_score: Optional[int] = Form(None), h02_by: str = Form(""), h02_note: str = Form(""),
    ):
        card_path = uploaded_scorecard(scorecard_id)
        load_scorecard(card_path)  # refuses a scorecard that is not frozen, before anything is uploaded or sent
        cfg = load_config(config_path)
        if not mock:
            keys = provider_key_status(cfg)
            used = {s.get("provider", cfg.get("provider", "gemini")) for s in cfg["raters"] + [cfg["consolidator"]]}
            missing = [n for n in used if not keys.get(n)]
            if missing:
                raise HTTPException(400, f"No API key found for {', '.join(missing)}. Add it to .env and restart, or use the dry run.")
            if not confirm_external:
                raise HTTPException(400, "Tick the box to confirm these documents may be sent to the model provider.")

        job_id = uuid.uuid4().hex[:12]
        folder = runs_dir / "_uploads" / job_id
        folder.mkdir(parents=True, exist_ok=True)
        art_path = await save_upload(artifact, folder, ARTIFACT_SUFFIXES)
        source_specs: list[str] = []
        for up in sources:
            if up.filename:
                source_specs.append(str(await save_upload(up, folder, SOURCE_SUFFIXES)))
        if use_workbook_sources and art_path.suffix.lower() in {".xlsx", ".xlsm"}:
            try:
                present = openpyxl.load_workbook(art_path, read_only=True).sheetnames
            except Exception as exc:  # unreadable workbook
                raise HTTPException(400, f"{art_path.name} could not be opened as a workbook: {exc}") from exc
            found = [s for s in WORKBOOK_SOURCE_SHEETS if s in present]
            if found:
                source_specs.append(f"{art_path}::{','.join(found)}")

        human: dict = {}
        for hid, score, by, note in (("H01", h01_score, h01_by, h01_note), ("H02", h02_score, h02_by, h02_note)):
            if score is not None and by.strip():
                human[hid] = {"score": score, "by": by.strip(), "note": note.strip()}
        human_path = None
        if human:
            human_path = folder / "human_evidence.yaml"
            human_path.write_text(yaml.safe_dump(human), encoding="utf-8")

        job = Job(job_id)
        with lock:
            jobs[job_id] = job
            for old in list(jobs)[:-MAX_JOBS_KEPT]:
                jobs.pop(old, None)

        req = EvalRequest(artifact_spec=str(art_path), scorecard_path=card_path, source_specs=source_specs,
                          config_path=config_path, out_root=runs_dir, human_path=human_path, mock=mock,
                          assume_yes=True, on_stage=job.stage)

        def work() -> None:
            job.status = "running"
            try:
                rep, run_dir = run_evaluation(req)
                v = rep["verdict"]
                job.result = {"run_id": rep["header"]["run_id"], "decision": v["decision"], "final": v["final"],
                              "weighted_score": v["weighted_score"], "mock": rep["header"]["mock"],
                              "findings": len(rep["findings"]),
                              "high": sum(1 for f in rep["findings"] if f["severity"] == "HIGH")}
                job.stage("Done")
                job.status = "done"
            except (InputError, LLMError) as exc:
                job.error, job.status = str(exc), "error"
            except Exception as exc:  # keep the server alive and show a plain message
                traceback.print_exc()
                job.error, job.status = f"Unexpected error: {exc}", "error"

        threading.Thread(target=work, daemon=True).start()
        return {"job_id": job_id}

    @app.get("/api/jobs/{job_id}")
    def job_status(job_id: str):
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Unknown job.")
        return job.view()

    # ------------------------------------------------------------------ reports
    @app.get("/api/runs/{run_id}/{fmt}")
    def report(run_id: str, fmt: str, download: bool = False):
        if not RUN_ID.match(run_id) or fmt not in {"html", "md", "json"}:
            raise HTTPException(404, "Not found.")
        path = runs_dir / run_id / f"report.{fmt}"
        if not path.is_file():
            raise HTTPException(404, "Report not found.")
        media = {"html": "text/html; charset=utf-8", "md": "text/markdown; charset=utf-8", "json": "application/json"}[fmt]
        headers = {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:"}
        if download:
            headers["Content-Disposition"] = f'attachment; filename="evaluation-{run_id}.{fmt}"'
        return FileResponse(path, media_type=media, headers=headers)

    @app.exception_handler(InputError)
    async def input_error(_, exc: InputError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    return app
