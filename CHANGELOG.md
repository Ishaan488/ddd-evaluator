# Changelog

All notable changes to the DDD Evaluator. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.6.0] - 2026-10-23

### Added
- **Counting in the text of a PDF.** Three new code checks count words and identifiers in every line of a document, so they work on a PDF as well as
  a workbook: `text_terms_absent` (share of lines free of listed words, such as vague terms), `text_terms_present` (share of required terms that appear)
  and `text_ids_valid` (share of ID-shaped tokens that fit a strict pattern). A miss is cited as "Page n · line m". Nothing to count in (no lines, no IDs,
  unknown sheet) leaves the question unscored and flagged instead of scoring it as perfect.
- **Import can hand a counted criterion to code.** When counting words or IDs settles a criterion exactly, the import proposes a `check` for it. Code
  makes it its own `measured_by: code` question (weight shared by criteria count, the source's ratio bands 98/90/75/50/>0%) and the review table
  shows "Counted by code" with what it counts. The words or pattern are the model's proposal unless the source lists them, so the import notes say
  "confirm before approving". A proposal the app cannot run is dropped and the criterion stays with a person. The counts are by line of text; where
  the source counts fields or rows, the import says so.

## [1.5.0] - 2026-10-23

### Added
- **Import a scorecard written in any layout** (sidebar "Import a scorecard", `POST /api/scorecards/import`). An examiner model reads the file
  (Excel, PDF, YAML, JSON, CSV or text) and drafts it in this app's format, optionally using the file it will judge so the draft names real sheets or
  page ranges. Code then checks the draft: it is never frozen, never claims an approval, counted criteria become "needs a person", and unknown
  sheets or pages are dropped, with every change listed. A person compares it with the original side by side, edits it, and approves it with their
  name (`POST /api/scorecards/check`), which freezes it and records who approved it and when. The draft is not trusted until then.
- **Every finished report is also saved as files**, in any database mode: `data/reports/<project>/iteration-<n>/report.json`, `.md`, `.xlsx` and `.pdf`,
  rewritten when a person adds evidence or an override. Even on the in-memory demo database a result is never lost. `docker compose up --build` now runs
  the whole app with Postgres (history kept in the `ddd_pgdata` volume, files in `./data`).
- **Steadier scores.** `settings.repeats` (default 1; 3 in `models.bedrock.json`) makes each examiner score each section several times and keeps the
  median (the lower middle of two), noting how far the runs differed. Each judged question now carries a **confidence**: steady (two or more examiners
  within a point, and stable across repeats), shaky, or single (only one examiner could score it); the report page shows "Scores differ" for shaky ones.
- **A shaky score cannot force RED alone.** With a scorecard's `red_at_or_below`, a must-pass question at the red line forces RED only when the score
  is reliable. A single-examiner score or an unresolved disagreement keeps the result AMBER and says a person should check it.
- Fixed: finding references (`A1`, `A2`, ...) restarted in every section, so findings from different sections could share a reference and be mixed up by the consolidator.
- Import: judged questions get anchors written for that question (the general anchor is only the fallback), and each lists the criteria it covers.
- **Import splits dimensions in code.** The model labels each criterion judged or counted; code splits mixed dimensions into a judged question and a
  `-counted` question for a person, shares the weight by criteria count, trims over-long PDF page ranges (3 pages on free tiers, 10 on a roomy
  roster), and fills missing anchors from the source's general anchor. `npm run scorecard:import` does the same from a terminal.
- **Sections can run at the same time** (`settings.sectionConcurrency`, default 1; 3 in `models.bedrock.json`). Scores are identical to one at a time.
- Import review page: a table of the questions found (who marks each, weight, must-pass, pages), with the original and the raw YAML folded away.
- `MODELS_CONFIG` may be a repository-relative path (`server/config/models.bedrock.json`) from any folder; `models.bedrock.json` now uses GLM 5, Llama 3.3 70B, Mistral Large and Nova Pro.
- **`red_at_or_below`** (optional scorecard setting, also a row on the Excel `Scorecard` sheet): a critical dimension scoring at or below it forces RED
  whatever the total, as in the mentor's GS-1 scorecard. Without it nothing changes.
- **Amazon Bedrock provider** (`type: "bedrock"`, Converse API, Bedrock API key as a bearer token). A second roster file,
  `server/config/models.bedrock.json` (Claude, Llama, Mistral + Nova as consolidator), is chosen with `MODELS_CONFIG`; the default Groq + Gemini
  roster is unchanged. `models:check` lists a region's models and matches inference-profile ids (`us.`, `eu.`). Model ids in the file are
  unverified placeholders until checked against a real account.
- **PDF as the file to check.** Each page becomes a sheet named `Page n` and each line a cell in column A, so raters cite `Page 3!A12`
  and the rest of the pipeline is unchanged. A scorecard may name page ranges (`Page 7-9`) in its sheets and in a dimension's `reads`.
  Repeated headers, footers and bare page numbers are dropped. Scanned (image-only) PDFs are refused with a clear message.
  Only rater questions apply to a PDF; code checks need Excel columns. Draft scorecard: `samples/talentra/talentra-output-schema-pdf.yaml`.
- **PDF report** (`/api/runs/:id/report.pdf`, `report.pdf` from the CLI, "PDF" in the Download menu): verdict, a prioritised "What to improve"
  list, colour-coded scores, strengths and the path to green.
- **"What to improve" sheet** first in the Excel report: one ordered to-do list (findings by severity, low scores, items only a person can
  supply) with a Done column and a filter. Dimension scores are now colour-coded.

## [1.4.0] - 2026-10-23

### Added
- **Sectioned scoring.** A rater dimension can list `reads`: the sheets, and optionally columns, it needs (`Tree[Path id|Name|Definition]`). Questions
  with the same `reads` share a prompt (a section); each section goes to the three raters on its own and the results are merged. Scorecards without
  `reads` behave exactly as before. In Excel the entries go in a `Reads` column of the `Dimensions` sheet.
- The consolidator is sent only the sheets behind dimensions the raters disagree on by more than a point (everything, as before, for unsectioned scorecards).
- The size check at submit now judges each section on its own and names the section that is too big.
- `npm run prompt:size -- <workbook> <scorecard>` shows, without any API call, the tokens per sheet, per section and which raters can take each.
- `samples/talentra/talentra-schema-d2-sectioned.yaml`: the D2 scorecard with `reads` (same questions, weights and anchors).
- `evaluate` also writes `run-log.json` (models, real token counts, timings).
- **Dashboard rewrite in plain words.** The report page now shows the result, a "What to do next" list and tabs (Scores, What to fix, Examiner agreement, Needs your input,
  Path to green, Strengths, Technical details). Scores are grouped by who checked them and colour-coded; hints explain the terms; downloads are in one menu.
  All wording lives in `web/src/copy.ts`.
- GitHub Actions CI: typecheck, tests, build and docs check on every push and pull request, with mock models only (no API keys).

### Changed
- The orchestrator runs every scorecard through one section loop (an unsectioned scorecard is one section) instead of two copies of the rater code.

### Verified
- 187 server tests and the web tests pass. One live run of the sectioned D2 scorecard on free Groq and Gemini keys: AMBER 84.8 in 3 min 56 s (was impossible before),
  partial because of provider limits (details in the README).

## [1.3.0] - 2026-10-23

### Added
- **Fallback models.** A rater or the consolidator can list backup models, tried in order if its model fails (overload, quota, prompt too large). A fallback answers
  as the same participant and counts as the same family, so three different families are always kept. Fallbacks must be approved; one without a key
  is skipped with a warning. The report names the model that really answered, the run notes say what failed first, and the live view shows the model answering now.
- `models:check` lists and pings fallbacks; the Models page shows them. `server/config/models.json` gives Gemini rater B a fallback (`gemini-3.1-flash-lite`).

### Verified
- A full evaluation (Step 04 scorecard) ran on live Groq and Gemini models. Live, a Gemini quota error (HTTP 429) was absorbed by a fallback, and a Groq size refusal
  (HTTP 413) left one rater out cleanly while the run finished.

## [1.2.1] - 2026-10-23

### Fixed
- The first live run failed because the schema prompt is far bigger than estimated. The token estimate is now calibrated against what Groq
  counted (2.7 characters per token, not 4), and the documentation numbers are corrected (18,000 to 21,500 tokens per rater, not 13,400).
- The app now **checks before running**: at submit it measures the real prompt against each rater's `maxInputTokens` and refuses the
  evaluation, with a plain explanation and fixes, if fewer than two raters can take it.
- Provider errors now show the provider's sentence instead of a block of JSON.
- Transient provider overloads (503) are retried five times instead of three.

### Changed
- `server/config/models.json`: the Groq raters carry the token limits Groq reported for this account (8,000 and 7,000).

## [1.2.0] - 2026-10-23

### Changed
- **Dashboard redesign.** One typeface everywhere (Inter, bundled with the app, no monospace), a larger type scale, roomier cards,
  tables, buttons and inputs, bigger section tabs that share the width evenly, and a restructured set of stylesheets
  (`tokens`, `base`, `layout`, `components`, `charts`, `pipeline`, `pages`, `report`).
- **Motion.** Pages rise in, the score ring draws and counts up, the threshold marker slides to the score, hover and focus states ease,
  loading shows skeleton blocks, dialogs pop in over a blurred backdrop. All of it respects reduced-motion settings.
- History: whole rows are clickable, dates no longer wrap, and wide tables scroll inside their card instead of overflowing.

## [1.1.0] - 2026-10-22

### Added
- **Excel scorecards.** A scorecard can be written as an `.xlsx` (sheets `Scorecard`, `Sheets`, `Dimensions`) and uploaded like a YAML file.
  It reads into the same validated scorecard, with errors that name the sheet and row. A starter template is downloadable from the
  New evaluation page (`GET /api/scorecard-template.xlsx`), and `npm run scorecard:xlsx` converts YAML to Excel (round trip gives the identical hash).
- **Extra instructions box.** Optional text for the examiners, sent to every rater and the consolidator, saved with the run (new column `runs.instructions`,
  migration `002_instructions.sql`) and hashed in the report header. Shown in the Markdown and Excel reports.
- Excel versions of both Talentra sample scorecards.

### Changed
- `PROMPT_VERSION` is now `l1-prompts/1.1` (the prompts gained an `<instructions>` section and a rule about it).
- The default model roster now uses models that answered a live `models:check --ping` on a Groq and a Gemini key.

### Fixed
- Starting the server with `DATABASE_URL` set but Postgres not running now says how to fix it (start Docker, or remove the URL) instead of printing a stack trace.
- `npm run models:check -- --ping` dropped the `--ping` flag; the ping's token budget was too small for reasoning models.

## [1.0.0] - 2026-10-22

First release: the **Level 1 evaluator agent** from the Agentic Roadmap.

### Added
- The evaluator agent (`server/src/agent/`): freeze, count in code, three blind raters, a consolidator, a verdict decided
  by rule, and an eight-section report with a path to green.
- Nine built-in code checks, and scorecards in the PDF's YAML/JSON format.
- Provider adapters for Groq and any OpenAI-compatible API, and for Gemini; a scripted mock provider for tests and demos.
- Postgres storage (plain SQL migrations) with an in-memory twin for tests; Docker Compose for Postgres.
- Dashboard (React, black theme): projects, new evaluation, live pipeline, report, iteration history, models.
- Command-line evaluator, `models:check`, and a demo-data seeder.
- Two draft scorecards for the Talentra workbook (schema gate and Step 04 output gate).
- Documentation set: architecture, agent, scorecard reference, API, operations, security, PDF traceability, decisions.

### Behaviour worth knowing
- A HIGH-risk finding blocks green (PDF p.11), even when the score is high.
- A custom read-only .xlsx reader replaces ExcelJS for input (ExcelJS cannot open the Talentra file).

### Not in this release
Calibration, shadow mode, the gate tracker, authentication and roles, sectioned evaluation. See
[docs/pdf-traceability.md](docs/pdf-traceability.md#not-built-yet).
