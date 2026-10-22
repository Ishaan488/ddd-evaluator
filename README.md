# DDD Evaluator

**The Level 1 evaluator agent** for the Talencia Global *Data-Driven Development · Agentic Roadmap*.

You give it a schema or output workbook and the **frozen scorecard** it is judged against. Three AI raters from three
model families score it blind, a fourth reconciles them, and a rule (never a model) decides **green, amber or red**.
You get the PDF's eight-section report with a path to green. A person fixes the file and submits it again; every
iteration is scored and kept, so you watch the score climb.

> Agents evaluate. People define, produce and approve. The evaluator **never edits** your work, never writes a
> schema or scorecard, and has no auto-fix loop. That is Level 1, as agreed with the mentor.

---

## Where is the agent?

| | |
|---|---|
| **The folder** | [`server/src/agent/`](server/src/agent/): everything that makes up the evaluator agent |
| **The entry point** | [`server/src/agent/orchestrator.ts`](server/src/agent/orchestrator.ts), function `evaluate()` |
| **Its public door** | [`server/src/agent/index.ts`](server/src/agent/index.ts): the rest of the app uses only this |
| **How it works, step by step** | [docs/agent.md](docs/agent.md) |

```
server/src/agent/
├── orchestrator.ts      ★ evaluate(): freeze → count → rate ×3 → consolidate → decide → report
├── rater.ts             runs one rater; keeps only evidence-backed claims
├── consolidate.ts       the 4th model + the code that enforces the PDF's rules on it
├── verdict.ts           green / amber / red, by rule
├── pathToGreen.ts       the smallest set of fixes that would change the verdict
├── findings.ts          findings from code checks, ids, ordering
├── evidence.ts          "does this cited cell really exist?"
├── callModel.ts  raterSchema.ts  types.ts
├── checks/              the nine exact checks done in code
└── prompts/             versioned rater and consolidator prompts
```

## Architecture

```mermaid
%% source: docs/diagrams/00-architecture.mmd
flowchart TB
  subgraph PEOPLE["PEOPLE · Level 1: people own every judgement"]
    direction LR
    AU["Author<br/>defines schema + scorecard<br/>fixes findings"] ~~~ PR["Peer reviewer<br/>checks fixes before<br/>re-evaluation"] ~~~ ME["Mentor / Lead<br/>human evidence<br/>gates and overrides"]
  end

  subgraph WEB["PRESENTATION · web/ · React 19 + Vite"]
    direction LR
    P1["Projects"] ~~~ P2["New evaluation"] ~~~ P3["Run report"] ~~~ P4["History"] ~~~ P5["Models"]
  end

  subgraph API["API + SERVICE · server/src/api/ · Express 5"]
    direction LR
    RT["Routes<br/>app.ts"] ~~~ SV["EvaluationService<br/>service.ts<br/>runs in background"] ~~~ DL["Report downloads<br/>xlsx, md, json"]
  end

  subgraph AGENT["EVALUATOR AGENT · server/src/agent/ · 3 raters + 1 consolidator · verdict decided by code"]
    direction TB
    ORCH["orchestrator.ts<br/>evaluate()<br/>runs the six stages,<br/>re-hashes at the end"]

    subgraph STAGES["The six stages"]
      direction LR
      S1["1 Freeze<br/>hash workbook<br/>+ scorecard"] --> S2["2 Count<br/>exact checks<br/>in code"] --> S3["3 Rate x3<br/>blind, 3 model<br/>families"] --> S4["4 Consolidate<br/>a 4th model<br/>reconciles"] --> S5["5 Decide<br/>verdict<br/>by rule"] --> S6["6 Explain<br/>findings, path<br/>to green"]
    end

    subgraph GUARD["GUARDRAILS · enforced in code, not in prompts"]
      direction LR
      G1["evidence.ts<br/>claims must cite<br/>a real cell"] ~~~ G2["callModel.ts<br/>strict JSON, one<br/>repair attempt"] ~~~ G3["raterSchema.ts<br/>replies checked<br/>for shape"] ~~~ G4["prompts/<br/>versioned and<br/>hashed per run"]
    end

    ORCH --> STAGES --> GUARD
  end

  subgraph ADAPT["ADAPTERS · swap one without touching the agent"]
    direction LR
    A1["Workbook<br/>reader<br/>excel/"] ~~~ A2["Report<br/>renderer<br/>report/"] ~~~ A3["Store<br/>db/<br/>Postgres, SQL"] ~~~ A4["Provider<br/>adapters<br/>llm/"]
  end

  subgraph DATA["YOUR DATA · stays on your machine"]
    direction LR
    UP[["Upload folder<br/>data/uploads<br/>copies, never edited"]] ~~~ PG[("Postgres 16<br/>docker compose<br/>up -d db")]
  end

  subgraph MODELS["MODEL PROVIDERS · approved models only"]
    direction LR
    GQ["Groq"] ~~~ GM["Gemini"] ~~~ OA["Any OpenAI-<br/>style API"]
  end

  PEOPLE -->|browser| WEB
  WEB -->|REST /api| API
  API -->|evaluate| AGENT
  AGENT -->|uses| ADAPT
  ADAPT -->|files + database| DATA
  ADAPT -->|HTTPS| MODELS

  classDef person fill:#334155,stroke:#94a3b8,color:#f8fafc
  classDef ui fill:#1e293b,stroke:#64748b,color:#f8fafc
  classDef agent fill:#0f766e,stroke:#2dd4bf,color:#ffffff
  classDef guard fill:#115e59,stroke:#5eead4,color:#ffffff
  classDef store fill:#1e3a8a,stroke:#7aa2f7,color:#ffffff
  classDef ext fill:#92400e,stroke:#f5b13d,color:#ffffff
  class AU,PR,ME person
  class P1,P2,P3,P4,P5,RT,SV,DL,A1,A2,A3,A4 ui
  class ORCH,S1,S2,S3,S4,S5,S6 agent
  class G1,G2,G3,G4 guard
  class UP,PG store
  class GQ,GM,OA ext
  style AGENT fill:transparent,stroke:#14b8a6,stroke-width:3px
  style STAGES fill:transparent,stroke:#14b8a6
  style GUARD fill:transparent,stroke:#14b8a6,stroke-dasharray:4 4
  style PEOPLE fill:transparent,stroke:#64748b
  style WEB fill:transparent,stroke:#64748b
  style API fill:transparent,stroke:#64748b
  style ADAPT fill:transparent,stroke:#64748b
  style DATA fill:transparent,stroke:#7aa2f7
  style MODELS fill:transparent,stroke:#f5b13d
```

> The same diagram as a static image (for viewers that do not draw Mermaid): [`docs/images/architecture.svg`](docs/images/architecture.svg).

More views, all in [docs/architecture.md](docs/architecture.md): system context, one evaluation end to end, the iteration
loop, the data model, deployment. The security view is in [docs/security.md](docs/security.md).

## What it does

![The six stages](docs/images/02-agent-pipeline.svg)

1. **Freeze**: read the workbook once, hash it and the scorecard, refuse an unfrozen scorecard or an invalid roster.
2. **Count in code**: everything countable (depth, blanks, duplicates, allowed lists) is scored exactly by code.
3. **Rate**: three blind raters score the judgement dimensions 0-5, each citing the cell it relied on.
4. **Consolidate**: a fourth model reconciles; code enforces the rules (the lower score stands if a disagreement can't be resolved).
5. **Decide**: a function applies the PDF's rule. A HIGH-risk finding blocks green; a critical gate must reach 4.
6. **Report**: eight sections as `.xlsx`, `.md` and `.json`, with a path to green and a full audit trail.

| The report, with the verdict, critical gates and scores | Score trend across iterations |
|---|---|
| ![Report](docs/images/screens/report.png) | ![History](docs/images/screens/history.png) |

## Quick start

Needs Node 22+ (`nvm use`).

```bash
npm install
npm run build                      # builds the dashboard
MOCK_LLM=1 npm run start           # http://localhost:4000 with scripted models, no keys, no Docker
npm run seed:demo -w server        # second terminal: three iterations of the sample schema
```

The sidebar says **Mock models (demo)** so a demo is never mistaken for a real evaluation.

**Real run** (Postgres + Groq + Gemini):

```bash
cp .env.example .env               # add GROQ_API_KEY, GEMINI_API_KEY, DATABASE_URL
docker compose up -d db            # Postgres 16 on localhost:5432
npm run models:check -- --ping     # keys valid? models exist? do they answer?
npm run start
```

**Command line, no server or database:**

```bash
npm run evaluate -- --workbook samples/talentra/Talentra-Feature-Discovery-Dashboard.xlsx \
                    --scorecard samples/talentra/talentra-schema-d2.xlsx --mock \
                    --instructions "Be strict about definitions."       # optional
```

**The scorecard can be an Excel file or YAML.** Download a ready-to-edit Excel template from the *New evaluation* page, or use
`samples/talentra/talentra-schema-d2.xlsx`. Both formats give the identical scorecard. The page also has a box for **extra
instructions** to the examiners, which are saved with the result. See [docs/scorecard-reference.md](docs/scorecard-reference.md).

Full setup, configuration and troubleshooting: [docs/operations.md](docs/operations.md).

## Repository structure

```
ddd/
├── README.md  CHANGELOG.md  docker-compose.yml  .env.example  .nvmrc  .editorconfig
│
├── docs/                         documentation (start at docs/README.md)
│   ├── agent.md                    what the agent does, and where its code is
│   ├── architecture.md             how the system fits together
│   ├── scorecard-reference.md      the scorecard format and the nine checks
│   ├── api.md                      REST API reference
│   ├── operations.md               install, configure, run, back up, troubleshoot
│   ├── security.md                 data handling, controls, residual risks
│   ├── pdf-traceability.md         every PDF page mapped to code and tests
│   ├── decisions.md                why it was built this way
│   ├── development.md              working on the code
│   ├── diagrams/                   Mermaid sources + render.sh
│   └── images/                     rendered diagrams and dashboard screenshots
│
├── samples/talentra/             the Talentra workbook and two DRAFT scorecards, each as .yaml and .xlsx (need mentor approval)
│
├── scripts/                      checkDocs.mjs: verifies every doc link, anchor, path and folder tree
│
├── shared/src/                   types and scorecard schema shared by server and dashboard
│
├── server/
│   ├── config/                     models.json (live roster) · models.mock.json (demo roster)
│   ├── scripts/                    modelsCheck.ts · seedDemo.ts · patchCells.ts · scorecardToExcel.ts
│   ├── src/
│   │   ├── agent/                  ★ the evaluator agent
│   │   ├── api/                    Express routes and EvaluationService
│   │   ├── db/                     pool, migrations (plain SQL), store
│   │   ├── excel/                  read-only .xlsx reader and the text the raters are sent
│   │   ├── llm/                    Groq / Gemini / OpenAI-compatible adapters, roster rules, mock provider
│   │   ├── report/                 the eight-section report as .xlsx and .md
│   │   ├── scorecard/              scorecard parsing and hashing (YAML, JSON or Excel)
│   │   └── util/
│   └── tests/                    157 tests
│
└── web/src/                      the dashboard
    ├── pages/                      Projects · New evaluation · Run · Project history · Models
    ├── components/  styles/  api.ts  hooks.ts  format.ts
```

## Documentation

| | |
|---|---|
| [docs/agent.md](docs/agent.md) | What the agent does, the six stages, guardrails, failure handling, where each part lives |
| [docs/architecture.md](docs/architecture.md) | Context, layers, dependency rules, sequence, data model, deployment |
| [docs/scorecard-reference.md](docs/scorecard-reference.md) | Writing a scorecard: fields, dimensions, checks, bands |
| [docs/api.md](docs/api.md) | Endpoints with examples |
| [docs/operations.md](docs/operations.md) | Setup, configuration, models, database, cost, backup, troubleshooting |
| [docs/security.md](docs/security.md) | Controls, trust boundaries, and the gaps to close before real client data |
| [docs/pdf-traceability.md](docs/pdf-traceability.md) | The Agentic Roadmap PDF, page by page: done, partial, not built |
| [docs/decisions.md](docs/decisions.md) | Fifteen design decisions with reasons |
| [docs/development.md](docs/development.md) | Conventions, tests, recipes, definition of done |

## Technology

TypeScript (strict) on Node 22 · Express 5 · React 19 + Vite + React Router (plain CSS on design tokens, one bundled typeface, Inter) · Postgres 16 (Docker), plain SQL ·
Zod validation at every boundary · Vitest. Models over plain HTTPS: Groq and any OpenAI-compatible API, and Gemini.
No agent framework and no ORM; the reasons are in [docs/decisions.md](docs/decisions.md).

## Quality

```bash
npm run typecheck      # shared, server, web
npm test               # 157 server tests + 3 dashboard tests, all deterministic
npm run docs:check     # every doc link, anchor, path and folder tree is real
```

The tests follow the PDF's rules: every guardrail, every kind of misbehaving model (invalid JSON, no evidence,
outages, out-of-range consolidation), **planted defects in the real Talentra file that must never come out green**,
the provider adapters, the API, and iteration history. The same API tests pass on a real Postgres
(`TEST_DATABASE_URL=...`). Details in [docs/development.md](docs/development.md#testing).

## Status and limits

Read this before relying on a verdict.

- **No full evaluation has been run on live models yet.** The roster in `server/config/models.json` answered a live
  `models:check --ping` (one Groq key, one Gemini key), but a complete evaluation has only been run on scripted models. Model availability varies by account and over time, so re-run the ping on your own keys.
- **The two scorecards are drafts** and say so in every report until your mentor approves them.
- **Prompt size.** The Talentra schema prompt is about 13,400 tokens: fine for Gemini and paid Groq tiers, too big for
  Groq's free tier (such a rater fails early with a clear message). Sectioned evaluation is not built.
- **No authentication, no TLS, no rate limiting.** Put it behind your reverse proxy with sign-in for shared use.
  Full list: [docs/security.md](docs/security.md#residual-risks-read-these).
- **Not built from the PDF:** calibration set and measures, shadow mode, the D1-D4 gate tracker, roles.
  See [docs/pdf-traceability.md](docs/pdf-traceability.md#not-built-yet).

## Roadmap

Levels 2-4 (generator agents, template pipeline, raw thoughts to delivery) are out of scope: the PDF says each level
is earned with evidence from the one below. Next for Level 1: calibration against human scores, sectioned evaluation,
the gate tracker, and authentication. Details in [docs/pdf-traceability.md](docs/pdf-traceability.md#not-built-yet).
