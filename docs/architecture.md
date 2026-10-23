# Architecture

This page describes how the DDD Evaluator is put together: the parts, how they talk, where the data lives,
and how it is meant to be deployed. For what the evaluator agent itself does, see [agent.md](agent.md).

## Contents

1. [Goals and constraints](#goals-and-constraints)
2. [System context](#system-context)
3. [Layers](#layers)
4. [Dependency rules](#dependency-rules)
5. [One evaluation, end to end](#one-evaluation-end-to-end)
6. [The iteration loop](#the-iteration-loop)
7. [Data model](#data-model)
8. [Runtime model](#runtime-model)
9. [Deployment](#deployment)
10. [Failure modes](#failure-modes)
11. [Observability](#observability)
12. [Technology](#technology)

## Goals and constraints

The system exists to carry out **Level 1** of the Agentic Roadmap: evaluator agents score every deliverable
against its scorecard, and people keep the judgement. That fixes the shape of the design.

| Goal | What it means for the design |
|---|---|
| Trustworthy scores | Everything that can be counted is counted in code; models only judge what needs judging, and every claim they make is checked against the file |
| Auditable | Every input, prompt, raw reply, score and decision is stored; any result can be explained |
| Independent | The evaluator never edits the work it judges and never shares a session with the author; raters come from different model families |
| People decide | The agent recommends. Human evidence and overrides are first-class, stored beside the agent's own verdict |
| Honest under failure | Degrade visibly (flag, leave out, fail loudly), never silently |
| Small and replaceable parts | Providers, storage and report formats sit behind thin adapters |

Out of scope by design: generating schemas or scorecards, auto-fixing, template pipelines (Levels 2-4).

## System context

![System context](images/01-system-context.svg)

Three kinds of people use it. The **author** submits work and fixes findings. The **peer reviewer** checks fixes
before a re-evaluation. The **mentor or lead** supplies human-only evidence (for example the author interview),
approves gates and may override a verdict. All three use the dashboard.

## Layers

```mermaid
%% source: docs/diagrams/00-architecture.mmd
flowchart TB
  subgraph PEOPLE["PEOPLE · Level 1: people own every judgement"]
    direction LR
    AU["Author<br/>defines schema + scorecard<br/>fixes findings"] ~~~ PR["Peer reviewer<br/>checks fixes before<br/>re-evaluation"] ~~~ ME["Mentor / Lead<br/>human evidence<br/>gates and overrides"]
  end

  subgraph WEB["PRESENTATION · web/ · React 19 + Vite"]
    direction LR
    P1["Projects"] ~~~ P2["New evaluation"] ~~~ P6["Import a<br/>scorecard"] ~~~ P3["Run report"] ~~~ P4["History"] ~~~ P5["Models"]
  end

  subgraph API["API + SERVICE · server/src/api/ · Express 5"]
    direction LR
    RT["Routes<br/>app.ts"] ~~~ SV["EvaluationService<br/>service.ts<br/>runs in background"] ~~~ SI["Scorecard import<br/>draft, check,<br/>person approves"] ~~~ DL["Report downloads<br/>xlsx, pdf, md, json"]
  end

  subgraph AGENT["EVALUATOR AGENT · server/src/agent/ · 3 raters + 1 consolidator · verdict decided by code"]
    direction TB
    ORCH["orchestrator.ts<br/>evaluate()<br/>runs the six stages,<br/>re-hashes at the end"]

    subgraph STAGES["The six stages"]
      direction LR
      S1["1 Freeze<br/>hash workbook<br/>+ scorecard"] --> S2["2 Count<br/>exact checks<br/>in code"] --> S3["3 Rate x3<br/>blind, 3 families,<br/>median of repeats"] --> S4["4 Consolidate<br/>a 4th model<br/>reconciles"] --> S5["5 Decide<br/>verdict<br/>by rule"] --> S6["6 Explain<br/>findings, path<br/>to green"]
    end

    subgraph GUARD["GUARDRAILS · enforced in code, not in prompts"]
      direction LR
      G1["evidence.ts<br/>claims must cite<br/>a real cell"] ~~~ G2["callModel.ts<br/>strict JSON, one<br/>repair attempt"] ~~~ G3["raterSchema.ts<br/>replies checked<br/>for shape"] ~~~ G4["prompts/<br/>versioned and<br/>hashed per run"]
    end

    ORCH --> STAGES --> GUARD
  end

  subgraph ADAPT["ADAPTERS · swap one without touching the agent"]
    direction LR
    A1["Workbook + PDF<br/>reader<br/>excel/"] ~~~ A2["Report<br/>renderer<br/>report/"] ~~~ A3["Store<br/>db/<br/>Postgres, SQL"] ~~~ A4["Provider<br/>adapters<br/>llm/"]
  end

  subgraph DATA["YOUR DATA · stays on your machine"]
    direction LR
    UP[["Upload folder<br/>data/uploads<br/>copies, never edited"]] ~~~ RP[["Saved reports<br/>data/reports<br/>json, md, xlsx, pdf"]] ~~~ PG[("Postgres 16<br/>docker compose<br/>up --build")]
  end

  subgraph MODELS["MODEL PROVIDERS · approved models only"]
    direction LR
    GQ["Groq"] ~~~ GM["Gemini"] ~~~ BR["Amazon<br/>Bedrock"] ~~~ OA["Any OpenAI-<br/>style API"]
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
  class P1,P2,P6,P3,P4,P5,RT,SV,SI,DL,A1,A2,A3,A4 ui
  class ORCH,S1,S2,S3,S4,S5,S6 agent
  class G1,G2,G3,G4 guard
  class UP,RP,PG store
  class GQ,GM,BR,OA ext
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

> The same diagram as a static image (for viewers that do not draw Mermaid): [`images/architecture.svg`](images/architecture.svg).

| Layer | Folder | Responsibility |
|---|---|---|
| Presentation | `web/` | React dashboard: projects, new evaluation, live run, report, history, models. Talks only to `/api` |
| API + service | `server/src/api/` | HTTP routes, request validation, uploads; `EvaluationService` validates a submission, stores it and runs the evaluation in the background |
| **Evaluator agent** | `server/src/agent/` | The six-stage evaluation, the guardrails and the decision rule. No knowledge of HTTP, databases or report formats |
| Adapters | `excel/`, `llm/`, `report/`, `db/` | One job each: read a workbook, call a model provider, render a report, persist data |
| Shared contract | `shared/` | Types and the scorecard schema used by both server and dashboard |

## Dependency rules

Dependencies point **inwards** towards the agent, and the agent depends on very little:

```
web  ──►  /api  ──►  api/  ──►  agent/  ──►  llm/ · excel/ · util/
                      │            ▲
                      ├──►  db/ ───┘ (types only)
                      └──►  report/ ──►  agent/ (verdict, path to green)
```

- `agent/` imports only `llm/`, `excel/`, `util/` and a config type. It never imports `api/`, `db/` or `report/`.
- `llm/`, `excel/` and `scorecard/` never import `agent/`.
- Everything outside `agent/` reaches it through its single door, [`agent/index.ts`](../server/src/agent/index.ts).

These were checked against the actual imports when this was written. Because the agent knows nothing about
Express or Postgres, it can be run from the command line (`npm run evaluate`) and tested without a server.

## One evaluation, end to end

![Sequence](images/03-evaluation-sequence.svg)

Points worth knowing:

- The `POST /api/runs` call **returns at once** with `202 Accepted`. The evaluation continues in the background and
  the dashboard polls `GET /api/runs/:id` every 1.5 seconds, showing which stage is running and which model has answered.
- All submission mistakes (unfrozen scorecard, unknown sheet, roster not ready, wrong file type) are caught **before**
  anything is stored or any model is called, and come back as a plain-language error.
- The three raters run in parallel; the consolidator runs after them.
- The report you read is **assembled on read** from the stored, immutable evaluation plus any human evidence
  and override. Adding evidence or an override never changes the agent's own scores.

## The iteration loop

![Iteration loop](images/06-iteration-loop.svg)

This is PDF page 12. The agent produces the verdict and the path to green; **a person** fixes the file and
resubmits. Each submission becomes a new iteration of the same project, scored independently. Resubmitting
under an existing project name adds an iteration to it, so the score trend, the fixed / still-open / new findings
and the per-dimension heatmap build up automatically.

A finding's identity across iterations (`fingerprint`) is the dimension for code findings (the failing cell moves
as rows get fixed) and dimension + cell for rater findings.

## Data model

![Data model](images/04-data-model.svg)

| Table | Holds |
|---|---|
| `projects` | A schema being iterated; name is unique |
| `runs` | One evaluation: status and stage, both hashes, a frozen copy of the scorecard, the immutable `core` (the evaluation), the `run_log`, the score and the agent / final decision |
| `model_calls` | Every model call: provider, model, family, exact prompt, raw reply, discarded claims, tokens, latency |
| `dimension_scores` | Each dimension's score, spread, rater scores and flag, queryable for trends |
| `findings` | Each finding with its location, fix and fingerprint |
| `human_evidence` | What a person supplied for a human-only dimension (optional score, note, who) |
| `overrides` | A person's override of a verdict, with the required reason |

Migrations are plain SQL in `server/src/db/migrations/`, applied once each in name order, on server start or with
`npm run db:migrate`. There is no ORM. The same SQL runs on real Postgres and on the in-memory Postgres (`pg-mem`)
used for tests and the no-Docker demo.

## Runtime model

- **One Node process** serves the API and, in production, the built dashboard.
- **Evaluations run in-process**, in the background of the request that started them. There is no separate queue
  or worker. This keeps the system small; the cost is that a crash loses in-flight work. On the next start,
  any run left "queued" or "running" is marked **failed** with an explanatory message, so nothing hangs forever.
- **Concurrency**: several evaluations can run at once. Provider rate limits are handled by the HTTP layer
  (retry with back-off, honouring `Retry-After`).
- **State**: the database holds all state. The only files are the uploaded workbooks (`data/uploads/`), kept as
  read-only copies so a run can be re-examined.

## Deployment

![Deployment](images/08-deployment.svg)

| Mode | How |
|---|---|
| Demo | `MOCK_LLM=1 npm run start`: scripted models, in-memory database, no keys, no Docker |
| Local, real | `docker compose up -d db`, keys in `.env`, `npm run start` |
| Shared / production | The same, on a VM, behind a reverse proxy that provides TLS and sign-in. **The app has no login of its own** (see [security.md](security.md)) |

`docker-compose.yml` starts **Postgres only**. The application is not containerised yet.

Scaling notes: a single process is sufficient for a team. To go beyond it, the natural step is to move
`EvaluationService.execute` onto a job queue and run several workers; the agent needs no change, because it is
a pure function of its inputs apart from the model calls.

## Failure modes

How each failure is handled is tabulated in [agent.md](agent.md#6-when-things-go-wrong). At system level:

| Failure | Effect | Recovery |
|---|---|---|
| Database down | API returns 500; nothing is lost that was stored | Restart the database; the app reconnects per request |
| Server crash mid-run | That run is marked failed on next start | Submit again |
| Provider outage or rate limit | Retries, then that rater is left out (or the run fails if all are down) | Fix the provider or change the roster |
| Disk full / uploads folder missing | Submission fails with a server error | Free space or set `DATA_DIR` |

## Observability

- The server logs one line per notable event to the console, prefixed `[ddd]`: start-up, migrations, roster
  problems, interrupted runs, unhandled errors. API keys are never logged.
- `GET /api/health` returns `{ ok: true, db: "postgres" | "memory" }` for liveness checks.
- Per-run observability is in the data: the `run_log` (timings, tokens, attempts per model) and `model_calls`.
- There are no metrics endpoint or tracing yet.

## Technology

| Concern | Choice | Why (details in [decisions.md](decisions.md)) |
|---|---|---|
| Language | TypeScript (strict), Node 22, ES modules | One language across agent, API and dashboard |
| API | Express 5 | Small, well known, async errors handled |
| Dashboard | React 19, React Router 7, Vite | Plain CSS with design tokens; no UI framework |
| Database | Postgres 16 (Docker), `pg` driver, plain SQL | Durable and inspectable; same SQL runs in-memory for tests |
| Models | Plain HTTPS to each provider; no agent framework | The flow is fixed; every rule must be enforceable and testable |
| Validation | Zod at every boundary (scorecard, requests, model replies) | Untrusted input is checked once, at the edge |
| Excel | Custom read-only reader (input), ExcelJS (report output) | The common library cannot open the Talentra file |
| Tests | Vitest; scripted mock models | Deterministic, fast, and able to simulate misbehaving models |
