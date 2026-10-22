# Changelog

All notable changes to the DDD Evaluator. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
