"""Command line: python -m ddd_evaluator evaluate --artifact ... --scorecard ... --source ..."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from . import report as report_mod
from .llm import LLMError
from .loader import InputError, load_env_file
from .pipeline import EvalRequest, run_evaluation


def _confirm(message: str) -> bool:
    print("\n" + message)
    if not sys.stdin or not sys.stdin.isatty():
        print("Not an interactive terminal. Re-run with --yes to confirm.")
        return False
    return input("Proceed? [y/N] ").strip().lower() in {"y", "yes"}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="ddd_evaluator", description="Level 1 evaluator agent: 3 raters + 1 consolidator.")
    sub = p.add_subparsers(dest="command", required=True)
    e = sub.add_parser("evaluate", help="Evaluate an artifact against a frozen scorecard and write the 8-section report.")
    e.add_argument("--artifact", required=True,
                   help="The schema under test. For a workbook, 'file.xlsx' uses the Tree, Schema register and Allowed values "
                        "sheets; or name sheets: 'file.xlsx::Tree,Schema register'.")
    e.add_argument("--scorecard", required=True, type=Path,
                   help="Frozen scorecard workbook (.xlsx). Make one with: python -m ddd_evaluator template")
    e.add_argument("--source", action="append", default=[],
                   help="Source document (docket, FRs, NFRs). Repeat for several. .md .txt .pdf .xlsx[::Sheet,Sheet]")
    e.add_argument("--human-evidence", type=Path, help="YAML with scores a person supplies for human-only dimensions.")
    e.add_argument("--config", type=Path, default=Path("config.yaml"))
    e.add_argument("--out", type=Path, default=Path("runs"), help="Folder for run logs and reports.")
    e.add_argument("--artifact-id", help="Name to show in the report (default: the file name).")
    e.add_argument("--artifact-version", help="Version to show (default: detected from the text, for example 'Schema v1.4').")
    e.add_argument("--mock", action="store_true", help="Offline dry run with fake raters. Scores mean nothing.")
    e.add_argument("--yes", action="store_true", help="Do not ask before sending documents to the models.")
    e.add_argument("--allow-unfrozen", action="store_true", help="Allow a scorecard that is not frozen (trial runs only).")

    s = sub.add_parser("serve", help="Start the local web page (upload a schema, see the scorecard, read the report).")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--host", default="127.0.0.1", help="Keep the default: the page has no login and is meant for this computer only.")
    s.add_argument("--config", type=Path, default=Path("config.yaml"))
    s.add_argument("--out", type=Path, default=Path("runs"))

    t = sub.add_parser("template", help="Write a blank scorecard workbook to fill in.")
    t.add_argument("--out", type=Path, default=Path("scorecard-template.xlsx"))

    m = sub.add_parser("models", help="List the Gemini models your key can call, and check config.yaml against them.")
    m.add_argument("--config", type=Path, default=Path("config.yaml"))
    return p


def _models(config_path: Path) -> int:
    from .llm import GeminiProvider, build_providers
    from .loader import load_config

    cfg = load_config(config_path)
    provider = build_providers(cfg, mock=False, only=["gemini"]).by_name.get("gemini")
    if not isinstance(provider, GeminiProvider):
        print("error: config.yaml has no provider of type gemini.", file=sys.stderr)
        return 2
    available = {m["name"].removeprefix("models/"): m for m in provider.list_models()}
    print(f"Your key can call {len(available)} models with generateContent:\n")
    for name in sorted(available):
        print(f"  {name:<40} in {available[name].get('inputTokenLimit', '?'):>9}  out {available[name].get('outputTokenLimit', '?')}")
    wanted = [(f"rater {r['id']}", r["model"]) for r in cfg["raters"]] + [("consolidator", cfg["consolidator"]["model"])]
    print("\nconfig.yaml:")
    bad = 0
    for role, model in wanted:
        ok = model.removeprefix("models/") in available
        bad += not ok
        print(f"  {'ok     ' if ok else 'MISSING'} {role}: {model}")
    if bad:
        print("\nEdit the MISSING ids in config.yaml. Being listed does not guarantee free-tier quota; see aistudio.google.com/rate-limit.")
    return 1 if bad else 0


def main(argv: list[str] | None = None) -> int:
    os.system("")  # lets Windows terminals show colour
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    load_env_file()
    if args.command == "models":
        try:
            return _models(args.config)
        except (InputError, LLMError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    if args.command == "serve":
        import uvicorn

        from .web.app import create_app

        if args.host not in {"127.0.0.1", "localhost"}:
            print("warning: the page has no login. Only expose it on a network you trust.", file=sys.stderr)
        print(f"DDD Evaluator running at http://{args.host}:{args.port}  (Ctrl+C to stop)")
        uvicorn.run(create_app(args.config, args.out), host=args.host, port=args.port, log_level="warning")
        return 0
    if args.command == "template":
        from .scorecard_io import write_template

        write_template(args.out)
        print(f"Wrote {args.out}. Fill in the 'Scorecard' and 'Dimensions' sheets; see 'Instructions'.")
        return 0
    req = EvalRequest(
        artifact_spec=args.artifact, scorecard_path=args.scorecard, source_specs=args.source, config_path=args.config,
        out_root=args.out, human_path=args.human_evidence, mock=args.mock, allow_unfrozen=args.allow_unfrozen,
        artifact_id=args.artifact_id, artifact_version=args.artifact_version, assume_yes=args.yes,
    )
    try:
        rep, run_dir = run_evaluation(req, confirm=_confirm)
    except (InputError, LLMError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(report_mod.terminal_summary(rep, str(run_dir / "report.html")))
    return {"GREEN": 0, "AMBER": 10, "RED": 20}[rep["verdict"]["decision"]]


if __name__ == "__main__":
    raise SystemExit(main())
