# Changelog

All notable changes to the DDD Evaluator. Format follows [Keep a Changelog](https://keepachangelog.com/).

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
