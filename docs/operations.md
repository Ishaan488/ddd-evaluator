# Operations guide

How to install, configure, run and look after the evaluator. For what it does, see [agent.md](agent.md).

## Contents

1. [Prerequisites](#prerequisites)
2. [Install and first run](#install-and-first-run)
3. [Configuration](#configuration)
4. [Choosing and checking models](#choosing-and-checking-models)
5. [Database](#database)
6. [Running](#running)
7. [Cost and rate limits](#cost-and-rate-limits)
8. [Backup and restore](#backup-and-restore)
9. [Upgrading](#upgrading)
10. [Troubleshooting](#troubleshooting)

## Prerequisites

| Need | For |
|---|---|
| Node.js 22 or newer (`.nvmrc` pins 22) | everything |
| Docker Desktop | Postgres for real use (optional for the demo) |
| API keys for your model providers | live evaluations (not needed for the demo) |

## Install and first run

```bash
npm install
npm run build                    # builds the dashboard into web/dist
MOCK_LLM=1 npm run start         # demo: scripted models, in-memory database
```

Open http://localhost:4000. The sidebar says **Mock models (demo)**. Data is lost when the server stops.

For real use:

```bash
cp .env.example .env             # fill in keys and DATABASE_URL
docker compose up -d db          # Postgres 16 on localhost:5432
npm run models:check -- --ping   # keys valid? models exist? do they answer?
npm run start
```

`npm run start` runs the database migrations first (they are idempotent), then serves the API and the dashboard.
During development use two terminals: `npm run dev:server` and `npm run dev:web` (http://localhost:5173, which proxies `/api`).

## Configuration

Settings come from the **environment**, loaded from `.env` in the project root (a `.env` inside `server/` is also read). A real environment
variable always wins over the file, so CI and containers can override it.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | empty | Postgres connection string. Empty means an **in-memory** database that forgets everything on exit |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, ... | empty | One key per provider used by the roster. The variable names come from `models.json` (`keyEnv`) |
| `PORT` | `4000` | HTTP port |
| `DATA_DIR` | `./data` (project root) | Where uploaded workbooks are kept (`data/uploads/<run id>/`) |
| `MODELS_CONFIG` | `server/config/models.json` | Use a different roster file |
| `MOCK_LLM` | unset | `1` = scripted models from `models.mock.json`, no API calls |
| `MOCK_DELAY_MS` | `700` | Pause per mock call so live progress is visible |
| `DB_MODE` | derived | `memory` forces the in-memory database even if `DATABASE_URL` is set |

Keys are read from the environment only. They are never written to the database, never logged and never sent to the browser.

### The roster file: `server/config/models.json`

```jsonc
{
  "approved": ["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b", "groq:qwen/qwen3.8-27b", "gemini:gemini-3.5-flash", "gemini:gemini-3.1-flash-lite"],   // only these may receive project documents
  "providers": {
    "groq":   { "type": "openai-compatible", "baseUrl": "https://api.groq.com/openai/v1", "keyEnv": "GROQ_API_KEY" },
    "gemini": { "type": "gemini", "keyEnv": "GEMINI_API_KEY" }
  },
  "raters": [                                                  // exactly three, three different families
    { "id": "A", "provider": "groq",   "model": "openai/gpt-oss-120b", "family": "openai" },
    { "id": "B", "provider": "gemini", "model": "gemini-3.5-flash",    "family": "google",
      "fallbacks": [{ "provider": "gemini", "model": "gemini-3.1-flash-lite" }] },
    { "id": "C", "provider": "groq",   "model": "qwen/qwen3.8-27b",    "family": "alibaba", "maxInputTokens": 30000 }
  ],
  "consolidator": { "id": "K", "provider": "groq", "model": "openai/gpt-oss-20b", "family": "openai" },
  "settings": { "temperature": 0, "maxOutputTokens": 8192, "timeoutMs": 120000, "retries": 3 }
}
```

| Field | Notes |
|---|---|
| `approved` | `provider:model` or `provider:*`. A model not listed is refused. This is the confidentiality control |
| `providers.*.type` | `openai-compatible` (Groq, OpenAI, OpenRouter, Together ...), `gemini`, or `mock` |
| `raters` | Exactly three. Their `family` values must differ, or the roster is refused |
| `family` | Free text naming the model family (`meta`, `google`, `openai` ...). The independence rule compares these |
| `maxInputTokens` | Optional. A prompt estimated above this fails that rater at once with advice, instead of sending a doomed request |
| `fallbacks` | Optional list of backup models, tried **in order** if the model fails for any reason (overloaded, quota used up, prompt too large). A fallback answers as the same participant and **counts as the same family**, so the three raters stay three different families, and it must be on `approved` because it receives the documents. A fallback with no API key is skipped with a warning. The report names the model that really answered |
| `settings` | Temperature 0 for reproducibility; `retries` applies to rate limits, 5xx errors and timeouts |

The roster above is the one that answered a live `models:check --ping` on 22 to 23 October 2026 with one Groq and one Gemini key.
Model availability changes often and differs by account (for example Google lists models that new accounts cannot call, and
some preview models are overloaded or have no free quota), so **run `models:check --ping` on your own keys** and edit this
file if a model fails. The consolidator here shares a family with rater A, which gives a warning but is allowed.

## Choosing and checking models

```bash
npm run models:check              # lists each provider's models and marks which roster models exist
npm run models:check -- --ping    # also sends one tiny prompt to every roster model
```

It prints a tick or a cross per model (key set, approved, offered by the provider, answers). It exits non-zero if
anything is wrong, so it can gate a deployment.

Choose models from **three different families** for the raters; the consolidator ideally from a fourth. The PDF's reason:
raters from one family share blind spots.

## Database

- **Results are always saved twice.** The database keeps the history shown in the dashboard (Postgres survives restarts; the in-memory demo database does not). Whatever the mode, every finished report is also written to `data/reports/<project>/iteration-<n>/` as `report.json`, `report.md`, `report.xlsx` and `report.pdf`, and rewritten when a person adds evidence or an override.
- **Whole app in Docker**: `docker compose up --build` starts Postgres and the evaluator together (open http://localhost:4000); `MOCK_LLM=1 docker compose up` runs it on scripted models. The app container reads keys and `MODELS_CONFIG` from `.env`, talks to the database container, and keeps uploads in `./data`.
- **Start only the database**: `docker compose up -d db` (Postgres 16, user / password / database all `ddd`, port 5432, data in the
  `ddd_pgdata` volume, so it survives restarts and `docker compose down`).
- **Migrate**: automatic on server start, or `npm run db:migrate` (safe to repeat; applied files are recorded in `schema_migrations`).
- **Look inside**: connect any client (psql, DBeaver, TablePlus, pgAdmin) to `localhost:5432`. Useful tables:
  `runs`, `dimension_scores`, `findings`, `model_calls` (every prompt and raw reply), `human_evidence`, `overrides`.
  See the [data model](architecture.md#data-model).
- **Example queries**

```sql
-- score trend of every project
select p.name, r.iteration, r.weighted_score, r.agent_decision, r.final_decision
from runs r join projects p on p.id = r.project_id where r.status = 'done' order by p.name, r.iteration;

-- every human override, with its reason
select p.name, r.iteration, o.decision, o.reason, o.by_name, o.created_at
from overrides o join runs r on r.id = o.run_id join projects p on p.id = r.project_id;

-- claims that models made without evidence (and were discarded)
select run_id, participant_id, jsonb_array_length(discarded) as discarded from model_calls where jsonb_array_length(discarded) > 0;
```

- **Reset a demo**: `docker compose down -v` removes the volume and all data. This cannot be undone.

## Running

| Purpose | Command |
|---|---|
| Production-style | `npm run build && npm run start` (API + built dashboard on one port) |
| Development | `npm run dev:server` and `npm run dev:web` |
| One-off evaluation, no server or database | `npm run evaluate -- --workbook a.xlsx --scorecard s.yaml [--mock] [--out dir]` |
| Demo data | `npm run seed:demo -w server` (needs the server running) |

Paths given to `npm run evaluate` are resolved from the directory you typed the command in.

**Liveness**: `GET /api/health`. **Logs**: console, prefixed `[ddd]`. Stop with Ctrl-C; the server finishes
in-flight runs before exiting. A run that was in flight when the process **crashed** is marked failed on the next
start with the message "The server stopped before this evaluation finished. Submit it again."

## Cost and rate limits

Each evaluation makes **four model calls** (three raters and a consolidator), and each carries the artifact. For
the Talentra schema (169 nodes and 194 allowed values) with the sample scorecard, a rater prompt is about **18,000 to
21,500 tokens** (Groq counted 18,336 with the gpt-oss tokenizer and 21,482 with qwen's for the same text) and the
consolidator's is a little larger, so roughly **75,000 to 85,000 input tokens per evaluation**. The Step 04 NFR output is
about 6,000 per call. The app estimates at 2.7 characters per token, calibrated on that schema prompt. **It is only an estimate**: how many
characters make a token depends on the content (the NFR register, full of numbers, was counted by Groq at about 8,900
tokens where the estimate said about 6,000), and each provider counts differently. The provider's refusal is the final word,
and the run records the real counts. Treat the estimate as a guide for planning, not a guarantee.

- Extra instructions (up to 4,000 characters, roughly 1,000 tokens) are added to every call, so keep them short.
- Free tiers cap tokens per minute. Groq's `on_demand` tier reported 8,000 for `gpt-oss-120b` and 7,000 for `qwen3.8-27b`, far below the
  schema prompt. **At submit the app measures the prompt against each rater's `maxInputTokens` and refuses the evaluation, in plain words, if
  fewer than two raters can take it**, instead of failing three calls later. Fix it with a larger plan or model, a smaller scorecard,
  `columns` in the scorecard, or `reads` on the rater questions. `maxInputTokens` is account-specific: when you upgrade a plan, raise or remove it.
- Rate limits and transient errors are retried with back-off, honouring `Retry-After`, up to `retries` times.
- **Sectioned scoring** is built: a rater question can list the sheets and columns it needs (`reads`), and each group of questions is sent as its own
  smaller prompt. The size check judges every section on its own. See *Sectioned scoring* in the scorecard reference. Run
  `npm run prompt:size -- <workbook> <scorecard>` to see, without calling any model, how big each prompt is and which of your raters can take it.

## Backup and restore

State lives in two places: the **database** and the **uploads folder** (`DATA_DIR`). Back up both.

```bash
# database (standard Postgres tools; container name from docker-compose.yml)
docker exec ddd-postgres pg_dump -U ddd ddd > ddd-backup.sql
docker exec -i ddd-postgres psql -U ddd ddd < ddd-backup.sql        # restore into an empty database

# uploaded workbooks
tar czf ddd-uploads.tgz data/uploads
```

The `model_calls` table contains the full prompts, which include the content of the evaluated workbooks. Treat
backups with the same care as the documents themselves.

## Upgrading

1. Stop the server.
2. Pull the new code, `npm install`, `npm run build`.
3. Start it: new migrations are applied automatically. Migrations only ever add; they are never edited once released.
4. If `PROMPT_VERSION` changed (it is `l1-prompts/1.1` since the extra-instructions input was added), scores are not comparable with earlier iterations of the same project. Recalibrate
   (see [pdf-traceability.md](pdf-traceability.md#not-built-yet)).

## Troubleshooting

| You see | Cause | Fix |
|---|---|---|
| `The evaluator roster is not ready: Model B (...) has no API key. Set GEMINI_API_KEY in .env.` | A provider in the roster has no key | Add the key to `.env`, restart |
| `... is not on the approved list, so it may not receive project documents.` | Model missing from `approved` | Add `provider:model` to `models.json` if your organisation permits |
| `The three raters must come from three different model families.` | Two raters share a `family` | Change one rater to another family |
| `This scorecard is not frozen.` | The scorecard lacks `frozen: true` | Freeze it after approval |
| `<file> does not match the scorecard format:` followed by a list | The YAML is valid but wrong | Fix the listed fields; see [scorecard-reference.md](scorecard-reference.md) |
| `<file> is not valid YAML or JSON: Nested mappings are not allowed...` | A value contains `: ` | Put the value in quotes |
| `my.xlsx does not match the scorecard format: Dimensions sheet, row 7 (J03): ...` | An Excel scorecard has a mistake in that row | Fix the named sheet and row; see [scorecard-reference.md](scorecard-reference.md#writing-a-scorecard-in-excel) |
| `The Excel scorecard needs a sheet called "Dimensions"` | The workbook lacks one of the three sheets | Start from the template (New evaluation page) |
| `This scorecard is not frozen` for an Excel scorecard | The `frozen` setting is not `yes` | Set `frozen` to `yes` on the Scorecard sheet |
| `The scorecard names a sheet "X" that this workbook does not have. Sheets found: ...` | Wrong sheet name or workbook | Correct the sheet name |
| `Column "X" named by the scorecard was not found in sheet "Y". Columns: ...` | Wrong column title in `columns` | Use the exact header title |
| `The file is not a valid .xlsx workbook` | A different or corrupt file | Re-save as .xlsx |
| `All three raters failed, so nothing can be scored.` + reasons | Providers down, keys wrong, rate limited, prompts too big | Read each reason; run `models:check -- --ping` |
| `This evaluation sends about N tokens to each rater, but only 1 of 3 raters can take that` | The prompt is bigger than the limits set for the raters (shown at submit) | Add `columns`, use a smaller scorecard, or give a rater a model or plan with a larger limit |
| `The prompt is about N tokens, over the M limit set for <model>.` | `maxInputTokens` exceeded for one rater during a run | Same as above |
| `HTTP 413: Request too large for model ... Limit 8000, Requested 18336` | The provider's tokens-per-minute limit is smaller than the prompt | As above: a larger plan or model, or a smaller prompt |
| `HTTP 429: You exceeded your current quota` (Gemini) | The free-tier quota for that model is used up (newer models have small daily quotas) | Rely on the model's `fallbacks`, wait for the quota to reset, or use a paid key |
| `HTTP 429` in a rater's error | Provider rate limit after all retries | Use a higher tier or retry later |
| `HTTP 503: This model is currently experiencing high demand` | The provider is overloaded; the app retried (5 times with waiting) | Submit again a little later, or pick a less busy model |
| `The workbook changed while it was being evaluated.` | The file was modified during the run | Submit again |
| `Cannot reach the server. Is it running?` (dashboard) | Server stopped or wrong port | Start it; in development check the Vite proxy port |
| Dashboard shows "Mock models (demo)" in real use | `MOCK_LLM=1` is set | Unset it |
| `Cannot reach Postgres at localhost:5432. DATABASE_URL is set but nothing is answering there.` | `DATABASE_URL` is in `.env` but Postgres is not running | `docker compose up -d db`, or remove `DATABASE_URL` to run on the in-memory demo database |
| `Postgres at ... rejected the user or password` / `has no such database` | Wrong credentials or database name in `DATABASE_URL` | Match `docker-compose.yml` (`ddd` / `ddd` / `ddd`) |
| History empty after a restart | `DATABASE_URL` empty, so the in-memory database was used | Set `DATABASE_URL` |
| A rater is shown as **Failed** but the report exists | By design: the run continues with the other raters and flags the gaps | See *Run notes* in the report |
