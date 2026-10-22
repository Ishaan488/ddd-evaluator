# Design decisions

The significant choices, with the reasons and what they cost. Each is short on purpose. Where the PDF decided
something, the PDF wins and the decision says so.

| # | Decision |
|---|---|
| [1](#adr-1-level-1-only-no-auto-fix) | Level 1 only: the agent evaluates, a person fixes |
| [2](#adr-2-no-agent-framework) | No agent framework; a fixed flow in plain code |
| [3](#adr-3-code-scores-the-countable-dimensions) | Code scores the countable dimensions |
| [4](#adr-4-the-verdict-is-a-function-not-a-model-output) | The verdict is a function, not a model output |
| [5](#adr-5-a-claim-without-a-real-cell-is-discarded) | A claim without a real cell is discarded |
| [6](#adr-6-the-evaluation-is-immutable-the-report-is-derived) | The evaluation is immutable; the report is derived |
| [7](#adr-7-a-custom-read-only-xlsx-reader) | A custom read-only .xlsx reader |
| [8](#adr-8-postgres-with-plain-sql-and-an-in-memory-twin-for-tests) | Postgres with plain SQL, and an in-memory twin for tests |
| [9](#adr-9-model-providers-over-plain-https) | Model providers over plain HTTPS |
| [10](#adr-10-evaluations-run-in-process) | Evaluations run in-process |
| [11](#adr-11-failures-degrade-visibly) | Failures degrade visibly |
| [12](#adr-12-prompts-are-versioned-artifacts) | Prompts are versioned artifacts |
| [13](#adr-13-a-scripted-mock-provider-is-part-of-the-product) | A scripted mock provider is part of the product |
| [14](#adr-14-everything-the-agent-needs-lives-in-one-folder) | Everything the agent needs lives in one folder |

---

## ADR-1: Level 1 only, no auto-fix

**Context.** The PDF's principle is *"you cannot automate what you have not made repeatable"*. Generator agents are
Level 2, to be earned with evidence from Level 1. The mentor confirmed in writing: the agent should not touch the
schema, and auto-fix is not required at Level 1.

**Decision.** The agent only evaluates. It reports; the author fixes and resubmits. The iteration loop is
manual, and every iteration is scored independently.

**Consequences.** The evaluator can never grade its own work, which is the independence guardrail. The cost is that
the loop to green needs a person each time. This is intended.

## ADR-2: No agent framework

**Context.** Frameworks such as LangGraph suit agents that decide their own next step. Here the flow is fixed:
freeze, count, rate, consolidate, decide, report. The PDF's rules (blind rating, evidence, lower score stands,
read-only) must be enforced exactly and tested.

**Decision.** Plain TypeScript. One function calls the raters in parallel, validates each reply, calls the
consolidator, then applies the rule. It is about the same size as a graph definition would be.

**Consequences.** Every rule is a function with a test; nothing sits between the rule and the code. If Level 2
generator agents are added later, a framework can sit **on top of** the evaluator without changing it.

## ADR-3: Code scores the countable dimensions

**Context.** The PDF has raters score every dimension. Many dimensions are counting questions: "how many nodes have a
definition?", "are any path ids duplicated?". A model asked to count 169 rows is slow, costs money and sometimes
miscounts, and three models may disagree about a plain fact.

**Decision.** A scorecard marks each dimension `code`, `raters` or `human`. Code dimensions are scored by built-in
checks that return an exact pass ratio, mapped to 0-5 by bands. Raters score only judgement dimensions, and are not
shown the code results (so they stay blind).

**Consequences.** Exact, free, repeatable scores for everything countable, and smaller rater prompts. This is the
main place the build goes beyond the PDF's wording. It is recorded in [pdf-traceability.md](pdf-traceability.md).

## ADR-4: The verdict is a function, not a model output

**Context.** The PDF fixes the decision rule (p.12). A model can be persuaded; a function cannot.

**Decision.** `agent/verdict.ts` computes green, amber or red from scores, gates, findings and human evidence. No
model ever writes or alters a verdict. A person can override, with a reason, and both are kept.

**Consequences.** Verdicts are reproducible and testable with a table of cases. A HIGH-risk finding caps the
verdict at amber (PDF p.11), so a high score cannot hide a serious problem. Scores are compared unrounded and shown
rounded down, so 89.96 never displays as 90.

## ADR-5: A claim without a real cell is discarded

**Context.** "Fluent but wrong" is the PDF's first risk: raters reward well-written text. The PDF requires every
score and finding to cite a location, and unsupported claims to be discarded.

**Decision.** A citation counts only if the sheet is part of this evaluation, the cell exists, and any quoted text
really appears in that cell. Otherwise the score or finding is dropped and counted in the report.

**Consequences.** A model cannot score what it did not read, and text planted in a document cannot fabricate
evidence. Small models may lose some claims to sloppy citations; the discard count makes that visible, and it is
an honest signal of that model's reliability.

## ADR-6: The evaluation is immutable; the report is derived

**Context.** People add evidence (an interview score) and overrides after the agent has finished. The agent's own
scores must never be edited, or the audit trail is worthless.

**Decision.** The stored result of a run (the *core*) never changes. The verdict, the "needs a person" list and the
path to green are recomputed from the core plus human input each time a report is read.

**Consequences.** Any report can be re-derived, adding evidence is instant and cannot corrupt the agent's record,
and overrides sit beside the agent's verdict. The cost is a small recomputation per read.

## ADR-7: A custom read-only .xlsx reader

**Context.** The general spreadsheet library (ExcelJS) crashed on the Talentra workbook, on a drawing part of the
file, before reading a single cell. Real submissions will come from many tools.

**Decision.** A small reader (`excel/xlsxReader.ts`, about 150 lines) unzips the file and reads cell values from
the XML directly. It ignores drawings, charts, images and styles, and it only reads. ExcelJS is still used to
*write* the report, where its input is under our control.

**Consequences.** It opens files the library cannot, and gives a smaller attack surface (nothing is executed).
Formulas that were never calculated are shown as their formula text. It does not evaluate formulas.

## ADR-8: Postgres with plain SQL, and an in-memory twin for tests

**Context.** The data must be durable and easy to inspect (the requester wants to see it in a database). Docker was
the stated way to run it. But tests and a quick demo should not need a server.

**Decision.** Postgres 16, `pg` driver, plain SQL migrations, no ORM. `pg-mem` (an in-memory Postgres) runs the
**same SQL** when no `DATABASE_URL` is set. The API tests run on both, and also on a real Postgres through
`TEST_DATABASE_URL`.

**Consequences.** One code path for storage, inspectable with any client. Only features `pg-mem` supports are used,
which keeps queries simple. Real Postgres remains the source of truth, and the same test suite has been run against it.

## ADR-9: Model providers over plain HTTPS

**Context.** Groq, Gemini and "other APIs" were all requested. Groq, OpenAI, OpenRouter and many others share the
OpenAI chat format; Gemini has its own.

**Decision.** Two small adapters over `fetch`: one OpenAI-compatible (configured by base URL and key variable), one
for Gemini. A shared HTTP helper retries rate limits and 5xx errors with back-off, honouring `Retry-After`. No vendor SDKs.

**Consequences.** Adding any OpenAI-compatible provider is a config entry. Few dependencies. Keys travel in headers
only. Provider-specific features such as structured output modes are not used; replies are validated by schema instead,
which works for every provider.

## ADR-10: Evaluations run in-process

**Context.** An evaluation takes tens of seconds to minutes. A queue and workers would add infrastructure for a
workload of a few evaluations at a time.

**Decision.** `POST /api/runs` returns `202` and the evaluation continues in the same process; progress is written to
the database as it goes, and the dashboard polls. A run left unfinished by a crash is marked failed on the next start.

**Consequences.** Simple to run and reason about. A crash loses in-flight work (the author submits again). If load
grows, `EvaluationService.execute` is the one seam to move onto a queue; the agent is unchanged.

## ADR-11: Failures degrade visibly

**Context.** Four model calls per evaluation means failures are normal: invalid JSON, rate limits, outages.

**Decision.** Each failure has a defined, visible outcome: one repair attempt for bad JSON; a failed rater is left
out and the gap flagged; a failed consolidator falls back to the lower score with a flag; a check that cannot run
becomes an unscored dimension with a HIGH finding; **all three raters failing fails the run** instead of reporting.

**Consequences.** The report always tells the truth about how it was produced ("Run notes"). The system never
invents confidence, and never shows a misleading red from missing data.

## ADR-12: Prompts are versioned artifacts

**Context.** The PDF requires prompts to be frozen and versioned "like any other artifact", and results to be
reproducible. Changing a prompt changes scores.

**Decision.** Prompts live in `agent/prompts/` with a `PROMPT_VERSION`. Each run records the version and a hash of the
exact prompt each model received, with the full prompt and raw reply.

**Consequences.** Any score can be traced to the exact words that produced it. Changing a prompt requires bumping the
version, and scores across versions are not comparable until recalibrated.

## ADR-13: A scripted mock provider is part of the product

**Context.** The behaviour that matters most is how the system handles models that misbehave. Live models cannot be
made to misbehave on demand, cost money, and vary.

**Decision.** A mock provider reads the real prompt and answers by persona (`mock-strict`, `mock-lenient`,
`mock-garbage`, `mock-nocite`, `mock-alarmist`, `mock-down` ...). It drives the tests and the no-key demo, which the
sidebar labels "Mock models (demo)".

**Consequences.** The complete pipeline, including prompt building, parsing, evidence checking and consolidation, is
tested deterministically. The limitation is also clear: passing tests prove the rules, not the quality of any live model.
That needs calibration against human scores.

## ADR-14: Everything the agent needs lives in one folder

**Context.** The agent's code was first spread across `eval/`, `checks/` and `prompts/`. Someone asking "where is the
agent?" had no single answer.

**Decision.** Everything that makes up the evaluator agent is in `server/src/agent/`, with a single public entry,
`agent/index.ts`. The agent imports only `llm/`, `excel/` and `util/`; the API, database and report layers import the
agent, never the reverse.

**Consequences.** One folder to read, review and test; the agent runs from the command line without a server. The
dependency rule is documented in [architecture.md](architecture.md#dependency-rules).
