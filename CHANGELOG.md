# Changelog

All notable changes to the DDD Evaluator. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
