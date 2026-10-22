# Traceability to the Agentic Roadmap PDF

How this build maps to *Talencia Global · Data-Driven Development · Agentic Roadmap* (v1.0, October 2026, 22 pages).
Only **Level 1, the evaluator agent**, is in scope (pages 9-19). Levels 2-4 are deliberately not built.

Status values: **Done** (built and tested), **Partial** (some of it), **Not built**, **Process** (an organisational
step, not software).

## Contents

- [Summary](#summary)
- [Principles (p.5)](#principles-p5)
- [Level 1 architecture and the 3 + 1 model (p.9-10)](#level-1-architecture-and-the-3--1-model-p9-10)
- [The evaluation report (p.11)](#the-evaluation-report-p11)
- [Decisions and routing (p.12)](#decisions-and-routing-p12)
- [Guardrails (p.13)](#guardrails-p13)
- [Calibration (p.14)](#calibration-p14)
- [Roles (p.15)](#roles-p15)
- [Build plan: the eight components (p.16)](#build-plan-the-eight-components-p16)
- [Formats and prompts (p.17)](#formats-and-prompts-p17)
- [Getting started: six moves (p.19)](#getting-started-six-moves-p19)
- [Risks (p.21)](#risks-p21)
- [Not built yet](#not-built-yet)
- [Where this build goes beyond the PDF](#where-this-build-goes-beyond-the-pdf)

## Summary

| Area | Status |
|---|---|
| Evaluator engine: orchestrator, 3 raters, consolidator, decision rule | Done |
| The eight-section report (workbook + readable summary) | Done |
| All eight guardrails | Done |
| Run log and audit trail | Done |
| Scorecard format, rater and consolidator prompts | Done |
| Score trend across iterations | Done (project history) |
| Calibration set and the calibration measures | **Not built** |
| Shadow mode comparison, gate tracker (D1-D4 board for every step) | **Not built** |
| Roles and permissions, review workflow for amber / red | **Not built** |

## Principles (p.5)

| # | Principle | Status | Where |
|---|---|---|---|
| 01 | Proven before automated | Process | Applies to when to adopt, not to the code |
| 02 | Evaluate before generate | Done | Level 1 only: no generators exist |
| 03 | Independent by design | Done | `llm/roster.ts` refuses a roster without three distinct families; a fallback model answers as the same participant and counts as the same family, so this holds when a model fails over (`agent/fallback.ts`); the evaluator never edits or runs in the author's session |
| 04 | Evidence, not opinion | Done | `agent/evidence.ts`: a score or finding must cite a real cell; otherwise discarded |
| 05 | People own the judgement | Partial | Human evidence, overrides with a reason, and "needs a person" flags are built; a rule that a person *must* review every amber or red is not enforced by the software |
| 06 | Everything is logged | Done | Prompts, raw replies, models, hashes, scores, discards, evidence and overrides stored (`model_calls`, `runs.run_log`, ...) |

## Level 1 architecture and the 3 + 1 model (p.9-10)

| PDF requirement | Status | Where | Test |
|---|---|---|---|
| One engine used at both gates (D1 against D2, D3 against D4) | Done | `scorecard.judges` selects the gate; same `evaluate()` | `orchestrator.test.ts` › the output gate |
| Artifact under test, frozen scorecard (hashed), source documents | Done | Workbook, scorecard and `sources` text field; both hashes in the report | › writes a header that proves what was evaluated |
| Frozen **schema** as an input to output evaluation | Partial | The schema is available to code checks through the same workbook; there is no separate "frozen schema" upload | |
| Orchestrator freezes inputs and sends to raters | Done | `agent/orchestrator.ts` | › Freeze |
| Three raters, different model families, blind | Done | `llm/roster.ts`, one shared prompt | › Independence, › keeps raters blind |
| Raters score every dimension 0-5 against the anchors | Done | `agent/rater.ts`, `raterSchema.ts` | `orchestrator.test.ts` |
| Raters cite the location for every score and finding | Done | `agent/evidence.ts` | `evidence.test.ts` |
| Findings carry a severity (high, medium, low) | Done | `agent/findings.ts`, rater findings | |
| A rater marks a dimension NOT MEASURABLE | Done | `not_measurable` in the reply; surfaced as "needs a person" | › treats a dimension every rater declines as not measurable |
| Consolidator reconciles, does not re-rate | Done | `agent/consolidate.ts`; code limits it to the raters' range | › refuses a consolidator score outside the range |
| Agree within one point: take the evidence-backed score | Done | `consolidate.ts` | |
| Differ by more than one: check claims against the artifact text | Done | The consolidator's score needs cited, validated evidence | › accepts the consolidator's score only when it cites real evidence |
| Unresolved: the lower score stands and a person is told | Done | `lower_stands`, flagged | › keeps the lower score and flags it |
| Merge duplicate findings, apply the decision rule, write the report | Done | `consolidate.ts`, `verdict.ts`, `report/` | |
| Rater spread reported per dimension | Done | Report sections 3 and 6 | `report.test.ts` |

## The evaluation report (p.11)

| Section | Status | Where |
|---|---|---|
| 1 Header: artifact id and hash, scorecard version and hash, raters and models, date and run id | Done | `report.header` |
| 2 Verdict: weighted score, decision, result of each critical gate | Done | `report.verdict` |
| 3 Dimension scores: each rater, consolidated, spread | Done | `report.dimensions` |
| 4 Strengths, with evidence | Done | `report.strengths` |
| 5 Gaps and findings: id, severity, dimension, location, fix, stage to return to | Done | `report.findings` |
| 6 Rater agreement: disagreements and how resolved | Done | `report.agreement` |
| 7 Not measurable here: items only a person can provide | Done | `report.notMeasurable` |
| 8 Path to green: smallest set of fixes in priority order | Done | `report.pathToGreen`, `agent/pathToGreen.ts` |
| Delivered as a workbook and a readable summary | Done | `report/xlsx.ts` (eight sheets) and `report/markdown.ts` |
| **High risk: blocks green, must be fixed before resubmission** | Done | A HIGH finding caps the verdict at amber (`agent/verdict.ts`) | `verdict.test.ts` › high-risk findings block green |
| Medium: fix in this pass **or record why it is deferred** | Partial | Medium findings are shown; recording a deferral reason is not built | |
| Low: improvement | Done | Shown, never blocks | |

## Decisions and routing (p.12)

| PDF requirement | Status | Where |
|---|---|---|
| Green: score ≥ 90, every critical gate passed, plus human-only evidence | Done | `agent/verdict.ts` | `verdict.test.ts` |
| Amber: score 75-89, or a critical gate below 4 | Done | Same |
| Red: score below 75 | Done | Same |
| Human-only items marked not measurable; cannot turn green until a person supplies them | Done | `scorecard` `measured_by: human`; evidence endpoint | `api.test.ts` |
| A person may override up or down, recording why | Done | `POST /api/runs/:id/override`; reason required; agent verdict kept | |
| Overrides are reviewed during calibration | Not built | Overrides are stored and queryable; the review process is not built |
| Every run is kept with inputs and report; score trend visible | Done | Postgres; project history page |
| Green: moves on, person confirms | Partial | The verdict and the confirmation controls exist; there is no downstream pipeline to move to at Level 1 |
| Amber: author fixes, peer reviews, evaluator runs again | Done (manual loop) | Each resubmission is a new iteration; the peer review itself is a human step |
| Red: back to Discover or Define with a mentor | Done | `return_to` on every finding; stated on the verdict |

Thresholds (90 and 75) are the scorecard's own `thresholds`, defaults as in the PDF ("proposed starting values for the team to confirm").

## Guardrails (p.13)

| Guardrail | Status | Where | Test |
|---|---|---|---|
| Independence: never in the author's session; different families | Done | `llm/roster.ts` | › Independence |
| Freeze: artifact and scorecard fixed and hashed before rating; nothing changes mid-evaluation | Done | `orchestrator.ts` hashes first and last | › Freeze |
| Blind rating | Done | One shared prompt, no scores in it | › keeps raters blind |
| Evidence: unsupported claims are discarded | Done | `evidence.ts`, `rater.ts` | › discards scores that cite no evidence |
| Lower score stands | Done | `consolidate.ts` | › keeps the lower score… |
| Read-only: never edits the artifact | Done | Reader only reads; file hashed after | › never touches the workbook |
| Reproducible: prompts, model versions, settings logged | Done | `model_calls`, `run_log`, `PROMPT_VERSION` | `api.test.ts` |
| Confidentiality: only approved models receive project documents | Done | `approved` list in `models.json` | › Confidentiality |

## Calibration (p.14)

None of this is built. **The data to build it is being collected**: scores per dimension, decisions, overrides and
all run logs are stored.

| Measure (target) | Status |
|---|---|
| Score agreement within ±1 of the human-adjudicated score, ≥ 90% | Not built |
| Decision agreement with the human verdict, ≥ 95% | Not built |
| False green rate, 0% on critical gates | Not built (the rule is strict by design; the rate is not measured) |
| False red rate, ≤ 10% | Not built |
| Rater spread, tracked | Partial: spread is stored per dimension per run; no trend report |
| Run stability, same inputs re-run, ≥ 95% | Not built |
| Cost and time per evaluation, tracked per step | Partial: tokens and timings are stored per run, not aggregated per step |
| The calibration set (deliverables already scored by people) | Not built; the existing schema scorecards v2.0-3.2 have not been loaded |

## Roles (p.15)

The five roles (author, peer reviewer, mentor, evaluator agent, agent platform team) exist as **people and one agent**,
not as software roles. There is no sign-in or permission model: any user can supply evidence or override. The
person's name is typed. See [security.md](security.md).

## Build plan: the eight components (p.16)

| Component | Status | Where |
|---|---|---|
| Formats: machine-readable schemas, scorecards and reports with version and hash | Done | Scorecard YAML/JSON with version and hash; report as JSON. Schemas stay as workbooks |
| Rater prompt | Done | `agent/prompts/rater.ts` (versioned) |
| Consolidator prompt | Done | `agent/prompts/consolidator.ts` |
| Orchestrator | Done | `agent/orchestrator.ts` |
| Report renderer: workbook and readable summary | Done | `report/` |
| Run log | Done | Postgres: `model_calls`, `runs.run_log` |
| Gate tracker: status of D1-D4 for every step | **Not built** | The project history shows iterations per project, not the D1-D4 board across steps |
| Calibration set | **Not built** | |

Sprints: foundations (0), schema evaluator (1) and output evaluator (2) are built. Phase 1 rollout and calibration review (3) are
process steps that need real deliverables and humans.

## Formats and prompts (p.17)

Scorecards can also be written in **Excel**; that file is converted to exactly the same validated structure and hash, so the
machine-readable, frozen, hashed scorecard the PDF asks for is unchanged (see
[scorecard-reference.md](scorecard-reference.md#writing-a-scorecard-in-excel)).

The scorecard example on page 17 is supported with **one addition**: an `artifact:` block that says which sheets
the agent reads (the PDF's example does not need it because it shows no workbook). Everything else is accepted as the PDF
writes it: `thresholds`, `critical`, `anchors` keyed 0-5, `measurable_by_agent: false`, and `judges: D1 schema · Step 01`. The rater and consolidator prompt patterns are
implemented as the starting point the PDF describes, versioned and hashed. Details in [scorecard-reference.md](scorecard-reference.md).

## Getting started: six moves (p.19)

| Move | Status |
|---|---|
| 1 Agree the formats | Done (this build proposes them) |
| 2 Freeze Phase 1 scorecards | Process. Two **draft** scorecards are provided and need mentor approval |
| 3 Load the calibration set | Not built |
| 4 Build the evaluator | Done |
| 5 Run in shadow mode (agent scores alongside people; compare) | Not built: the agent can run alongside people, but nothing compares results |
| 6 Switch on the gate | Process, after calibration meets the targets |

## Risks (p.21)

| Risk | Control in the PDF | Status here |
|---|---|---|
| Fluent but wrong | Evidence citation required; traceability a critical dimension | Evidence gate done. Traceability is a scorecard choice |
| Shared blind spots | Different model families; human calibration samples | Families enforced. Calibration samples not built |
| Writing to the scorecard | Fitness-for-next-step dimension; downstream proof | A scorecard design matter; frozen, versioned, hashed scorecards help |
| Model drift | Model versions logged; recalibrate on every change | Models and prompt version logged. Recalibration not built |
| Over-trust | Human review of every amber and red; overrides reviewed | Surfaced in the UI ("needs a person"); not enforced; override review not built |
| Confidential data | Approved models only | Done. See [security.md](security.md) for the remaining gaps |
| Cost and latency | Cost tracked per step; evaluate small sections first | Per-run tokens and timings stored. Sectioned evaluation not built |

## Not built yet

In rough order of value:

1. **Calibration**: load human-adjudicated deliverables, compute the p.14 measures, report them per model and prompt version.
2. **Sectioned evaluation** for large schemas, to cut cost and fit small-context models.
3. **Gate tracker**: a board of D1-D4 status across all 46 steps, linking to each report.
4. **Shadow mode** tooling: record the human score next to the agent's and show the comparison.
5. **Authentication and roles**, so "who approved" is verified, and a review step that a person must complete for every amber and red.
6. **Deferral records** for medium findings, and override review.
7. A separate frozen-schema input for output evaluation.

## Where this build goes beyond the PDF

Choices made where the PDF is silent or where a stricter rule protects the PDF's intent. Reasons in [decisions.md](decisions.md).

| Choice | Why |
|---|---|
| Countable dimensions are scored by code, not raters | Exact, free and repeatable |
| A dimension with no evidence-backed score counts as 0 and is flagged | A missing score must never help |
| Human-only items are left out of the weighted score until a person scores them | They cannot be measured by the agent |
| A critical dimension below 4 gives amber even if it scores 0 | Exactly the PDF's wording |
| Zero successful raters fails the run instead of reporting | A report built on nothing would show a misleading red |
| Scores shown rounded down; compared unrounded | 89.96 is never displayed as 90 |
| An optional **extra instructions** input is given to the raters and the consolidator (the PDF's rater pattern lists only the scorecard, the artifact and the sources, "nothing else") | Requested by the lead (an Excel scorecard plus a prompt box). It is identical for all raters so blind rating holds, is saved with the run and hashed in the report header, and the prompt rules say it can never change the scale, the evidence rule or the score. Leave it empty to follow the PDF exactly |
