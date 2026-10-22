# API reference

The dashboard and the command line are the only intended clients, but the HTTP API is plain REST and can be
scripted. Base URL in development: `http://localhost:4000`. All endpoints are under `/api`. Bodies are JSON,
except the upload.

> **There is no authentication.** Anyone who can reach the server can use every endpoint. Put it behind a reverse
> proxy with sign-in for shared use. See [security.md](security.md).

The exact response types are in [`shared/src/types.ts`](../shared/src/types.ts) (`RunDetail`, `Report`, `ProjectHistory`, ...).

## Conventions

- **Errors** are always `{ "error": "<message in plain words>" }` with a matching status code.
- `400` the submission or request is wrong (the message says what to fix) · `404` no such run, project or endpoint ·
  `409` the roster is not ready, or the run has no finished report yet · `500` an unexpected server error (see the server log).
- Timestamps are ISO 8601 UTC. Scores are numbers; the weighted score is 0-100 and rounded **down** to one decimal.
- Runs are **asynchronous**: submit, then poll the run until `status` is `done` or `failed`.

## Endpoints

| Method and path | Purpose |
|---|---|
| `GET /api/health` | Liveness: `{ "ok": true, "db": "postgres" \| "memory" }` |
| `GET /api/config` | The evaluator roster and whether it is ready |
| `GET /api/projects` | All projects with their latest run and a score history |
| `GET /api/projects/:id` | One project's iterations, trend, dimension heatmap and finding diffs |
| `POST /api/runs` | Submit a workbook and scorecard for evaluation |
| `GET /api/scorecard-template.xlsx` | Download a starter Excel scorecard |
| `GET /api/runs/:id` | One run: progress while running, the full report when done |
| `POST /api/runs/:id/evidence` | Record evidence a person supplies for a human-only dimension |
| `POST /api/runs/:id/override` | Override the verdict, with a reason |
| `GET /api/runs/:id/report.:ext` | Download the report as `xlsx`, `md` or `json` |

### `GET /api/config`

```json
{
  "mock": false,
  "ready": true,
  "promptVersion": "l1-prompts/1.0",
  "thresholds": { "accept": 90, "refine": 75 },
  "raters": [
    { "id": "A", "provider": "groq", "model": "openai/gpt-oss-120b", "family": "openai", "keyPresent": true, "approved": true }
  ],
  "consolidator": { "id": "K", "provider": "groq", "model": "openai/gpt-oss-20b", "family": "openai", "keyPresent": true, "approved": true },
  "problems": [{ "level": "error", "message": "Model B (gemini:gemini-3.5-flash) has no API key. Set GEMINI_API_KEY in .env." }]
}
```

`ready` is `false` while any `problems` entry has `level: "error"`. API keys are never returned, only whether one is set.

### `POST /api/runs`

`multipart/form-data` (limit 25 MB per file):

| Field | Type | Required | Notes |
|---|---|---|---|
| `workbook` | file | yes | Must be `.xlsx` |
| `scorecard` | file | yes | `.xlsx`, `.yaml`, `.yml` or `.json`; must be frozen (`frozen: true`, or `frozen = yes` in Excel). The Excel layout is in [scorecard-reference.md](scorecard-reference.md#writing-a-scorecard-in-excel) |
| `projectName` | text | no | Reuse a name to add an **iteration** to that project. Default: the workbook's file name |
| `sources` | text | no | Problem statement or docket the work is judged against |
| `instructions` | text | no | Extra instructions for the examiners, up to 4000 characters. Sent to all three raters and the consolidator and **recorded in the report header with a hash**. They steer what to look at; the rater prompt says they can never change the scale, the evidence rule or the score |

```bash
curl -X POST http://localhost:4000/api/runs \
  -F workbook=@Talentra-schema.xlsx \
  -F scorecard=@talentra-schema-d2.yaml \
  -F projectName="Talentra schema"
```

Returns `202 Accepted`:

```json
{ "runId": "0b5a...", "projectId": "7c1e...", "iteration": 3 }
```

Everything wrong with the submission is caught **before** anything is stored or any model is called, for
example: no workbook · not `.xlsx` · the file is not a real workbook · the scorecard does not match the format
(the message lists the issues, and for an Excel scorecard names the sheet and row) · the instructions are too long · the scorecard is not frozen · it names a sheet or column the workbook does not
have · the roster is not ready (`409`).

### `GET /api/runs/:id`

Poll this. While running, `stage` is one of `queued`, `reading`, `checks`, `rating`, `consolidating`,
`reporting` and `progress.participants` shows each model's status. When `status` is `done`, `report` holds the
eight sections; when `failed`, `error` says why.

```json
{
  "id": "0b5a...", "projectId": "7c1e...", "projectName": "Talentra schema", "iteration": 3,
  "status": "done", "stage": "done", "gate": "D1", "scorecardId": "SC-TALENTRA-D2",
  "weightedScore": 87.5, "agentDecision": "amber", "finalDecision": "amber",
  "progress": { "participants": [{ "id": "A", "role": "rater", "model": "openai/gpt-oss-120b", "status": "ok", "latencyMs": 8210 }] },
  "report": {
    "header": { "...": "ids, hashes, models, prompt version" },
    "verdict": { "weightedScore": 87.5, "decision": "amber", "agentDecision": "amber", "criticalGates": [], "reasons": [], "override": null },
    "dimensions": [], "findings": [], "agreement": [], "notMeasurable": [], "strengths": [],
    "pathToGreen": { "steps": [], "needsPerson": [], "resultingScore": 90.2, "resultingDecision": "amber", "note": "" }
  },
  "evidence": [],
  "runLog": { "...": "timings, tokens, attempts, prompt hashes" }
}
```

`agentDecision` is what the agent concluded. `finalDecision` is what stands after any human override.

### `GET /api/scorecard-template.xlsx`

Downloads a starter scorecard in the Excel layout. It is valid as it stands: one dimension counted by code, one scored by the
examiners, one human-only. Edit the sheet names, columns, weights and anchors to fit your own workbook.

### `POST /api/runs/:id/evidence`

Records what a person supplies for a human-only dimension (for example the author interview). The verdict is
recomputed immediately; the agent's own scores never change.

```json
{ "dimensionId": "H01", "score": 5, "note": "Interview held 22 Oct", "by": "Mentor" }
```

- `dimensionId` must be a human-only item in this run's report (otherwise `400`)
- `score` is an integer 0-5, or `null`/omitted to record a note without a score (this unblocks green but adds no points)
- `note` at least 3 characters; `by` required
- A later entry for the same dimension replaces the earlier one in the verdict; all entries are kept

Returns the updated run (same shape as `GET /api/runs/:id`).

### `POST /api/runs/:id/override`

```json
{ "decision": "red", "reason": "Schema is being replaced next week", "by": "Lead" }
```

`decision` is `green`, `amber` or `red`; `reason` is required (at least 5 characters). The agent's own verdict stays
in `agentDecision` and in the report. Returns the updated run.

### `GET /api/runs/:id/report.xlsx | .md | .json`

The report as a downloadable file: the PDF's eight sections as an eight-sheet workbook, as readable Markdown,
or as JSON. `409` if the run has no finished report. `404` for any other extension.

### `GET /api/projects/:id`

Returns the project, every run (including failed ones), and:

- `trend`: score and decision per finished iteration
- `dimensions`: each dimension's score per iteration, in the scorecard's own order (the heatmap)
- `findingDiffs`: per iteration, how many findings were `fixed`, are `stillOpen`, or are `added`
- `thresholds`: the accept and refine thresholds of the latest scorecard

## Scripting example

```bash
# submit, then wait for the verdict
RUN=$(curl -s -X POST localhost:4000/api/runs -F workbook=@a.xlsx -F scorecard=@s.yaml | jq -r .runId)
until [ "$(curl -s localhost:4000/api/runs/$RUN | jq -r .status)" != "running" ] \
   && [ "$(curl -s localhost:4000/api/runs/$RUN | jq -r .status)" != "queued" ]; do sleep 2; done
curl -s localhost:4000/api/runs/$RUN | jq '{status, finalDecision, weightedScore, error}'
```
