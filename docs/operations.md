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
  "approved": ["groq:llama-3.3-70b-versatile", "gemini:*"],   // only these may receive project documents
  "providers": {
    "groq":   { "type": "openai-compatible", "baseUrl": "https://api.groq.com/openai/v1", "keyEnv": "GROQ_API_KEY" },
    "gemini": { "type": "gemini", "keyEnv": "GEMINI_API_KEY" }
  },
  "raters": [                                                  // exactly three, three different families
    { "id": "A", "provider": "groq",   "model": "llama-3.3-70b-versatile", "family": "meta" },
    { "id": "B", "provider": "gemini", "model": "gemini-2.5-flash",        "family": "google" },
    { "id": "C", "provider": "groq",   "model": "openai/gpt-oss-120b",     "family": "openai", "maxInputTokens": 30000 }
  ],
  "consolidator": { "id": "K", "provider": "groq", "model": "qwen/qwen3-32b", "family": "alibaba" },
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
| `settings` | Temperature 0 for reproducibility; `retries` applies to rate limits, 5xx errors and timeouts |

The model names above are **examples that have not been verified against live accounts**. Use `models:check` to see what
each provider actually offers, then edit this file and restart the server.

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

- **Start**: `docker compose up -d db` (Postgres 16, user / password / database all `ddd`, port 5432, data in the
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
the Talentra schema (169 nodes and 194 allowed values) with the sample scorecard, a rater prompt is about **13,400
tokens** and the consolidator's about 13,900, so roughly **54,000 input tokens per evaluation**. The Step 04 NFR
output is about 4,000 per call, roughly 16,500 per evaluation. (Measured at about four characters per token; the run
log records the provider's real counts.)

- Free tiers of some providers cap tokens per minute well below 13,000; such a rater fails early with a clear message.
  Use a paid tier, use Gemini for the large calls, or narrow the prompt with `columns` in the scorecard.
- Rate limits and transient errors are retried with back-off, honouring `Retry-After`, up to `retries` times.
- The PDF's advice for cost is to evaluate small sections first. That is not built yet.

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
4. If `PROMPT_VERSION` changed, scores are not comparable with earlier iterations of the same project. Recalibrate
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
| `The scorecard names a sheet "X" that this workbook does not have. Sheets found: ...` | Wrong sheet name or workbook | Correct the sheet name |
| `Column "X" named by the scorecard was not found in sheet "Y". Columns: ...` | Wrong column title in `columns` | Use the exact header title |
| `The file is not a valid .xlsx workbook` | A different or corrupt file | Re-save as .xlsx |
| `All three raters failed, so nothing can be scored.` + reasons | Providers down, keys wrong, rate limited, prompts too big | Read each reason; run `models:check -- --ping` |
| `The prompt is about N tokens, over the M limit set for <model>.` | `maxInputTokens` exceeded | Add `columns` to the scorecard, or raise the limit |
| `HTTP 429` in a rater's error | Provider rate limit after all retries | Use a higher tier or retry later |
| `The workbook changed while it was being evaluated.` | The file was modified during the run | Submit again |
| `Cannot reach the server. Is it running?` (dashboard) | Server stopped or wrong port | Start it; in development check the Vite proxy port |
| Dashboard shows "Mock models (demo)" in real use | `MOCK_LLM=1` is set | Unset it |
| History empty after a restart | `DATABASE_URL` empty, so the in-memory database was used | Set `DATABASE_URL` |
| A rater is shown as **Failed** but the report exists | By design: the run continues with the other raters and flags the gaps | See *Run notes* in the report |
