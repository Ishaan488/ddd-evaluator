# Development guide

For people changing the code. To *run* the system, see [operations.md](operations.md). To understand the agent, see
[agent.md](agent.md).

## Repository layout

```
ddd/
├── README.md  ·  CHANGELOG.md  ·  docker-compose.yml  ·  .env.example  ·  .nvmrc  ·  .editorconfig
├── docs/                         documentation, diagram sources (diagrams/) and rendered images (images/)
├── samples/talentra/             the Talentra workbook and two draft scorecards
├── scripts/                      checkDocs.mjs: verifies links, anchors, paths and folder trees in the docs
│
├── shared/src/                   types and the scorecard schema, used by server and dashboard
│   ├── types.ts                    every type that crosses the API
│   └── scorecardSchema.ts          scorecard file format (Zod) → domain Scorecard
│
├── server/
│   ├── config/                   models.json (live roster) · models.mock.json (demo roster)
│   ├── scripts/                  modelsCheck.ts · seedDemo.ts · patchCells.ts
│   ├── src/
│   │   ├── agent/                ★ the evaluator agent (see agent.md)
│   │   │   ├── checks/             built-in code checks
│   │   │   └── prompts/            versioned rater and consolidator prompts
│   │   ├── api/                  Express routes (app.ts) and EvaluationService (service.ts)
│   │   ├── db/                   pool.ts · migrate.ts · store.ts · migrations/*.sql
│   │   ├── excel/                xlsxReader.ts · workbook.ts · serialize.ts
│   │   ├── llm/                  provider adapters, roster rules, mock provider, model catalog
│   │   ├── report/               assemble.ts · xlsx.ts · markdown.ts
│   │   ├── scorecard/            parse.ts
│   │   ├── util/                 hash.ts · errors.ts · text.ts
│   │   ├── config.ts  env.ts  cli.ts  index.ts
│   └── tests/                    Vitest suites and helpers
│
└── web/                          React dashboard
    └── src/
        ├── pages/                  Projects · NewEvaluation · Run · Project · Models  (+ report/ sections)
        ├── components/             Layout · Charts · Chip · DropZone · Pipeline · SectionNav · Icons
        ├── styles/                 tokens.css · base.css · layout.css · components.css · report.css
        ├── api.ts  hooks.ts  format.ts  App.tsx  main.tsx
```

### Dependency rules

`web` → `/api` · `api` → `agent`, `db`, `report` · `agent` → `llm`, `excel`, `util` · `db` and `report` → `agent` (via
`agent/index.ts` only). **The agent must never import `api/`, `db/` or `report/`.** See
[architecture.md](architecture.md#dependency-rules). Check it any time with:

```bash
grep -rlE "from '(\.\./)+(api|db|report)/" server/src/agent || echo "ok: the agent imports none of them"
```

## Setup

```bash
nvm use                 # Node 22 (see .nvmrc)
npm install
npm run typecheck && npm test
```

| Command | What it does |
|---|---|
| `npm run dev:server` | API with auto-reload (`tsx watch`) on :4000 |
| `npm run dev:web` | Dashboard with hot reload on :5173, proxying `/api` |
| `npm test` | Server tests (Vitest) then dashboard tests |
| `npm run typecheck` | TypeScript on shared, server and web |
| `npm run build` | Production build of the dashboard |
| `npm run docs:check` | Verifies every link, anchor, repository path and folder tree written in the docs |
| `npm run evaluate -- --workbook ... --scorecard ... --mock` | One evaluation from the command line |
| `npm run models:check -- --ping` | Check the real model roster |
| `npm run seed:demo -w server` | Fill a running server with three demo iterations |

Use `MOCK_LLM=1` for everything that does not need a real model.

## Conventions

- **TypeScript strict**, including `noUncheckedIndexedAccess`. ES modules with `.js` import suffixes (TypeScript resolves them to `.ts`).
- **Validate at the edge, trust inside.** Scorecards, request bodies and model replies are checked with Zod where they
  enter. Inside, types are trusted.
- **Errors for people are `UserError`** (a message safe to show, with a status). Everything else is a bug and returns a generic 500.
- **No ORM.** Plain SQL, parameterised. Keep to what `pg-mem` supports so tests keep running without Docker.
- **Pure where possible.** Verdict, path to green, consolidation rules and report assembly are pure functions of their
  inputs, which is why they are easy to test.
- **Comments explain why**, not what. Cite the PDF page when code exists because of a PDF rule.
- **The dashboard** uses plain CSS with design tokens (`styles/tokens.css`), no UI framework. Green, amber and red are
  reserved for verdicts and nothing else; teal is the agent colour.

## Testing

The suite is built around the PDF's rules. 128 server tests and 3 dashboard tests, all deterministic.

| File | What it proves |
|---|---|
| `verdict.test.ts` | The decision table: 90 / 75 edges, critical gates, human-only evidence, overrides, HIGH findings block green |
| `pathToGreen.test.ts` | Critical gates first, smallest set, blocking findings, human evidence |
| `checks.test.ts` | Each built-in check, `where` filters, a check that cannot run, band edges |
| `evidence.test.ts` | Real cell accepted; invented sheet, cell, quote or address rejected |
| `scorecard.test.ts` | The PDF format, error messages, the shipped samples, **and the example in the docs** |
| `reader.test.ts` | The real Talentra file opens; read-only; dates, rich text, formulas |
| `orchestrator.test.ts` | The whole pipeline; every guardrail; every kind of misbehaving model; planted defects must never be green |
| `promptSize.test.ts` | What raters are sent; token budgets for the samples (regression guard) |
| `providers.test.ts` | Groq/Gemini adapters against recorded response shapes: retries, back-off, key never in an error |
| `api.test.ts` | Every endpoint, validation errors, evidence and override, downloads, iteration history |
| `report.test.ts` | Eight sections, in order, in both formats; the core never changes |
| `catalog.test.ts`, `cli.test.ts` | Model listing and command-line paths |

**Scripted models.** `llm/mock.ts` answers from the real prompt by persona, chosen by model name:

| Persona | Behaviour |
|---|---|
| `mock-strict` / `mock-mid` / `mock-lenient` / `mock-low` | Scores 3 / 4 / 5 / 1 with valid citations |
| `mock-alarmist` | Scores 5 but raises a HIGH finding |
| `mock-garbage` | Replies with text that is not JSON |
| `mock-nocite` | Scores with no evidence |
| `mock-abstain` | Declines every dimension (not measurable) |
| `mock-down` | The provider fails |
| `mock-consolidator` / `-unresolved` / `-greedy` / `-down` | Reconciles / refuses to resolve / answers out of range / fails |

**Planted defects.** `server/scripts/patchCells.ts` edits the cell XML of the real Talentra workbook, so tests can plant a
4-level node, a duplicate id or missing definitions and assert the result is never green, even with perfect raters.

**Real Postgres.** The API tests also run on a real database:

```bash
TEST_DATABASE_URL=postgres://ddd:ddd@localhost:5432/ddd npm test -w server
```

Each test harness creates its own schema, so they do not disturb each other. Passing tests prove the rules and the
plumbing. They do **not** prove how good a live model is; that is what calibration is for (not built).

## Recipes

### Add a built-in check

1. In `agent/checks/library.ts`, write a `CheckDefinition`: `describe`, and `run(ctx, params)` that parses its params
   with Zod and returns `{ passed, total, failures, summary }`. Use `load`, `need`, `rowsWhere` and `countRows`.
2. Register it in the `CHECKS` map at the bottom.
3. Test it in `checks.test.ts`: the pass case, the failing cells, and `where`.
4. Document it in [scorecard-reference.md](scorecard-reference.md#built-in-checks).

### Add a model provider

- OpenAI-compatible: add it under `providers` in `server/config/models.json` (`type`, `baseUrl`, `keyEnv`) and its models to
  `approved`. No code.
- Another API shape: implement `LlmProvider` in `llm/` (see `gemini.ts`), add a `type` to `config.ts` and a case in
  `llm/registry.ts`, and cover retries and error messages in `providers.test.ts`. Keys go in headers, never URLs.

### Change what the models are told

Edit `agent/prompts/rater.ts` or `consolidator.ts` and **bump `PROMPT_VERSION`**. Update any test that checks prompt
content, and treat earlier iterations as not comparable.

### Add a database migration

Add a new file to `server/src/db/migrations/`, numbered after the last one (for example `002_add_reviews.sql`), in lower-case SQL. Never edit a released migration.
Check it on `pg-mem` (run the tests) and on a real Postgres.

### Change the verdict rule

The PDF fixes the rule, so change it only on the mentor's decision. Edit `agent/verdict.ts`, update the table in
`verdict.test.ts`, the diagram `docs/diagrams/05-verdict-rule.mmd`, [agent.md](agent.md) and
[pdf-traceability.md](pdf-traceability.md).

### Edit a diagram

Sources are Mermaid files in `docs/diagrams/`; the system architecture image `docs/images/architecture.svg` is a
hand-laid-out SVG. After editing a `.mmd` file:

```bash
bash docs/diagrams/render.sh      # needs Node; the first run downloads a headless Chromium
```

Commit both the source and the rendered SVG.

### Add a dashboard page

Add a file in `web/src/pages/`, a route in `App.tsx`, and a nav link in `components/Layout.tsx`. Fetch with
`useResource` (it handles loading, errors and polling). Reuse `Card`, `PageHeader`, `EmptyState` and the chips; take
colours from the tokens.

## Definition of done

- [ ] `npm run typecheck` and `npm test` pass (and `TEST_DATABASE_URL` tests if storage changed)
- [ ] New behaviour has a test, including the failing case
- [ ] If a PDF rule is involved, [pdf-traceability.md](pdf-traceability.md) is updated
- [ ] If behaviour users see changed, the docs and `CHANGELOG.md` are updated, and `npm run docs:check` passes
- [ ] The agent still imports nothing from `api/`, `db/` or `report/`
- [ ] No secret, key or client document is committed (`.env` is git-ignored)
