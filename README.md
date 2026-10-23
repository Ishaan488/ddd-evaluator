# ddd-evaluator

Level 1 evaluator agent from the Agentic Roadmap (slides 9 to 13): three independent LLM raters score an
artifact against a frozen scorecard, a fourth model consolidates them, and plain code decides
Green, Amber or Red. The agent only reads and reports. It never edits the artifact and never loops.

Status: the pipeline, scorecard reader, web page and report are built and tested offline (`python -m pytest -q`).
It has not yet been run against live Gemini models, and with one Gemini key the three raters are one model family,
not three as slide 10 asks. See [Status and known gaps](#status-and-known-gaps).

Design: [docs/evaluator-agent-architecture.md](docs/evaluator-agent-architecture.md)

## Set up

```powershell
pip install -r requirements.txt             # pypdf is only needed if the docket is a PDF
copy .env.example .env                      # then put your Gemini key in .env (aistudio.google.com/apikey)
python -m ddd_evaluator models              # lists the models your key can call and checks config.yaml
```

No key yet? Everything works with the dry run (`--mock`, or the "Dry run" option on the page). Scores from a dry
run are placeholders and the report says so.

## The web page

```powershell
python -m ddd_evaluator serve               # then open http://127.0.0.1:8000
```

1. Upload the schema (the workbook, or a .md, .sql or .txt file) and, if you have it, the docket.
2. Upload the scorecard (an Excel file). It is checked and then shown on the page; click a row to see its anchors
   from 0 to 5. Nothing is preloaded. A broken scorecard is rejected with every problem listed by sheet and row.
3. Choose a real evaluation or a dry run, and press Evaluate.
4. The report appears in the page, with downloads for HTML, Markdown and JSON.

The page runs on this computer only. API keys stay in `.env` on the server and are never sent to the browser.

## Command line

```powershell
python -m ddd_evaluator evaluate `
  --artifact "Talentra-Feature-Discovery-Dashboard-1.xlsx" `
  --scorecard scorecards\SC-DISCOVER-D2.xlsx `
  --source talentra-docket.md `
  --source "Talentra-Feature-Discovery-Dashboard-1.xlsx::Requirements,NFR register"
```

- `file.xlsx::Sheet A,Sheet B` picks sheets. With no sheets named, an artifact workbook uses Tree, Schema register
  and Allowed values; a source workbook uses every sheet.
- `--mock` runs the whole pipeline offline with fake raters.
- The run asks before sending documents to the models. `--yes` skips the question.
- `--human-evidence file.yaml` supplies the human-only scores (see below).
- Exit code: 0 Green, 10 Amber, 20 Red, 2 for an input error.

Out, in `runs/<run_id>/`: `report.html` (colour coded), `report.md`, `report.json` (the eight sections of slide 11),
plus the run log: hashes, exact prompts, raw replies, code check results, model versions, token use.

## Scorecards are Excel files

A scorecard workbook has a `Scorecard` sheet (ID, version, what it judges, Frozen yes/no, thresholds) and a
`Dimensions` sheet (one row per dimension: weight, critical, scored by, measure, guidance, and the anchors for
5 down to 0). Weights must add up to 100 and the scorecard must be frozen.

- Blank template: `python -m ddd_evaluator template --out my-scorecard.xlsx`, or the link on the page.
- Scored by `code` uses built-in checks (listed on the template's `Code checks` sheet, ids K01 to K20). They read a
  workbook with `Tree`, `Schema register` and `Allowed values` sheets, and report "not measurable" on anything else.
- Scored by `llm` is judged by the three raters from your Guidance and anchors. Scored by `human` is supplied by a person.
- `scorecards/SC-DISCOVER-D2.xlsx` is the scorecard written for the Discover-phase schema (Steps 01, 03 and 04). It is
  an example to upload, not a default.
- Re-saving the workbook in Excel does not change the hash shown in the report, because the hash covers what the
  scorecard says, not the file.

## What the model sees

Workbooks are turned into compact text tables (one line per row, header once), never raw Excel. On your schema
workbook that is about 18k tokens. JSON would cost more, not less: JSON records came to 1.6 to 2.1 times as many
tokens, because every row repeats every field name. JSON is used where structure matters, for the raters' replies.

## Gemini free tier: what to know

- **One key is the right setup.** Google applies quotas per Google Cloud project, not per key. Extra keys from the same
  project add nothing, and keys from other accounts would still be the same model family.
- **Quotas change often.** Check yours at aistudio.google.com/rate-limit. A run makes four calls of roughly 40 to 50
  thousand input tokens each, so `config.yaml` runs the raters one after another and waits out per-minute limits.
  A daily limit stops the run with a clear message.
- **Independence is reduced.** Slide 10 asks for three model families. Three Gemini models are one family, so their
  blind spots may be shared. The report states this and treats the verdict as advisory. To add a second family, add
  a provider in `config.yaml` (type `openai_compatible`) and point one rater at it.
- **Confidentiality.** On the free tier Google may use what you send to improve its products, and human reviewers may
  read it. Its terms advise against sensitive data. Do not send the confidential brief unless that is acceptable.

## Who scores what

Every dimension in a scorecard says who scores it. In the example scorecard (`SC-DISCOVER-D2.xlsx`):

| Kind | Dimensions | Scored by |
|---|---|---|
| code | D01 to D05 (weight 20) | Deterministic checks in `ddd_evaluator/checks.py`, no LLM |
| llm | L01 to L12 (weight 66) | Three raters, then the consolidator, with guardrails in code |
| human | H01, H02 (weight 14) | A person: the page's "human evidence" box, or `--human-evidence` |

A verdict is Green only at 90 or more, every critical gate at 4 or more, no HIGH finding open, and every
human-only dimension supplied. Until the human evidence arrives, a Green is shown as `GREEN (provisional)`.

```yaml
H01: {score: 4, by: "Mentor name", note: "Interview on 24 October"}
H02: {score: 5, by: "Reviewer name", note: "Signed off"}
```

## Status and known gaps

Matches the Agentic Roadmap, slides 9 to 13: frozen and hashed inputs, three blind raters, a consolidator,
the eight-section report, the decision rule, and the guardrails.

Differs from it, or not built yet:

- **One model family.** The raters are three Gemini models. The report says so and marks the verdict advisory.
- **The consolidator is not a distinct fourth model.** `config.yaml` uses the same model as rater A.
- **No live run yet.** The Gemini client is tested against faked replies only. Model ids in `config.yaml` come from
  Google's models page and are unverified; run `python -m ddd_evaluator models`.
- **The decision rule is applied by code**, not by the consolidator model, so the verdict is reproducible.
- **No verdict override with a written reason**, no routing after the verdict, and no score trend across versions.
- **Output evaluation (D3 against D4)** works through any scorecard, but the frozen schema (D1) has no input slot of
  its own; pass it as a `--source`.
- **"Approved models only"** is a confirmation prompt, not an enforced list.
- Slides 14 to 19 (calibration, gate tracker, shadow mode, roles) are not built.

## Tests

```powershell
python -m pytest -q
```
