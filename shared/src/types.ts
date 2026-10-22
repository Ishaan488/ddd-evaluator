/**
 * Shared contract between the evaluator (server) and the dashboard (web).
 * Everything here mirrors the Level 1 pages of the Agentic Roadmap PDF:
 * 3 raters + 1 consolidator, 0-5 scores with evidence, green/amber/red verdict,
 * and the fixed eight-section evaluation report.
 */

export type Decision = 'green' | 'amber' | 'red';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type MeasuredBy = 'code' | 'raters' | 'human';
export type Gate = 'D1' | 'D3';
export type ReturnTo = 'Discover' | 'Define' | 'Generate' | 'Analyse' | 'Validate' | 'Refine';
export type DimensionStatus = 'scored' | 'unscored' | 'not_measurable';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed';
export type RunStage =
  | 'queued'
  | 'reading'
  | 'checks'
  | 'rating'
  | 'consolidating'
  | 'reporting'
  | 'done'
  | 'failed';
export type Resolution =
  | 'agreement'
  | 'claims_checked'
  | 'lower_stands'
  | 'single_rater'
  | 'code'
  | 'none';
export type ParticipantStatus = 'waiting' | 'running' | 'ok' | 'failed';

export const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/* ----------------------------- scorecard ----------------------------- */

export interface Band {
  /** Minimum pass ratio (0-1) for this band. */
  min: number;
  score: number;
}

export interface CheckSpec {
  id: string;
  params: Record<string, unknown>;
  bands: Band[];
  fix?: string;
}

export interface SheetSpec {
  name: string;
  headerRow: number;
  /** Raters see only these columns (by header title). Code checks still read the whole sheet. */
  columns?: string[];
}

export interface DimensionSpec {
  id: string;
  name: string;
  weight: number;
  critical: boolean;
  measuredBy: MeasuredBy;
  description?: string;
  measure?: string;
  /** Rater dimensions: anchor text for each score 0-5. */
  anchors?: Record<number, string>;
  /** Code dimensions: the deterministic check and how its ratio maps to 0-5. */
  check?: CheckSpec;
  /** Human dimensions: what a person has to supply. */
  needs?: string;
  returnTo?: ReturnTo;
}

export interface Scorecard {
  id: string;
  name: string;
  version: string;
  gate: Gate;
  step?: string;
  frozen: boolean;
  approval?: string;
  thresholds: { accept: number; refine: number };
  artifact: { sheets: SheetSpec[]; context: SheetSpec[] };
  dimensions: DimensionSpec[];
}

/* ------------------------------ models ------------------------------- */

export interface ModelRef {
  id: string;
  provider: string;
  model: string;
  family: string;
}

/* ------------------------------ report ------------------------------- */

export interface CellRef {
  sheet: string;
  cell: string;
}

export interface Evidence extends CellRef {
  quote?: string;
}

export interface ReportHeader {
  runId: string;
  projectName: string;
  iteration: number;
  step?: string;
  gate: Gate;
  artifactName: string;
  artifactHash: string;
  scorecardId: string;
  scorecardName: string;
  scorecardVersion: string;
  scorecardHash: string;
  scorecardApproval?: string;
  raters: ModelRef[];
  consolidator: ModelRef;
  promptVersion: string;
  /** Extra instructions typed by the person who submitted the work, and their hash. */
  instructions?: string;
  instructionsHash?: string;
  startedAt: string;
  finishedAt: string;
}

export interface DimensionResult {
  id: string;
  name: string;
  weight: number;
  critical: boolean;
  measuredBy: MeasuredBy;
  status: DimensionStatus;
  /** Valid, evidence-backed score from each rater; null = abstained or discarded. */
  raterScores: Record<string, number | null>;
  consolidated: number | null;
  spread: number | null;
  resolution: Resolution;
  flagged: boolean;
  rationale: string;
  evidence: Evidence[];
  /** Code dimensions only. */
  codeDetail?: { passed: number; total: number; summary: string };
  error?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  dimensionId: string;
  location: CellRef | null;
  title: string;
  detail: string;
  fix: string;
  returnTo: ReturnTo;
  source: 'code' | 'raters';
  reportedBy: string[];
}

export interface Strength {
  dimensionId: string;
  text: string;
  location: CellRef | null;
}

export interface AgreementRow {
  dimensionId: string;
  name: string;
  scores: Record<string, number | null>;
  spread: number | null;
  resolution: Resolution;
  flagged: boolean;
  note: string;
}

export interface HumanEvidence {
  id: string;
  runId: string;
  dimensionId: string;
  score: number | null;
  note: string;
  by: string;
  createdAt: string;
}

export interface Override {
  id: string;
  runId: string;
  decision: Decision;
  reason: string;
  by: string;
  createdAt: string;
}

export interface CriticalGate {
  dimensionId: string;
  name: string;
  score: number | null;
  status: 'passed' | 'failed' | 'pending';
}

export interface VerdictSection {
  weightedScore: number;
  decision: Decision;
  agentDecision: Decision;
  thresholds: { accept: number; refine: number };
  criticalGates: CriticalGate[];
  /** Ids of HIGH-risk findings. Until they are fixed the verdict cannot be green (PDF p.11). */
  blockingFindings: string[];
  reasons: string[];
  override: Override | null;
}

export interface NotMeasurableItem {
  dimensionId: string;
  name: string;
  critical: boolean;
  weight: number;
  reason: string;
  whatIsNeeded: string;
  evidence: HumanEvidence | null;
}

export interface PathStep {
  order: number;
  dimensionId: string;
  name: string;
  from: number;
  to: number;
  scoreGain: number;
  reason: 'critical gate' | 'score';
  findingIds: string[];
}

export interface PathToGreen {
  steps: PathStep[];
  /** HIGH-risk findings that must be fixed before resubmission. */
  blockingFindingIds: string[];
  needsPerson: string[];
  resultingScore: number;
  resultingDecision: Decision;
  note: string;
}

/** The immutable result of one evaluation. Verdict-related sections are derived from it. */
export interface EvaluationCore {
  header: ReportHeader;
  scorecard: Scorecard;
  dimensions: DimensionResult[];
  findings: Finding[];
  strengths: Strength[];
  consolidatorFailed: boolean;
  notes: string[];
}

/** The eight-section report (PDF page 11), assembled from the core + people's input. */
export interface Report {
  header: ReportHeader;
  verdict: VerdictSection;
  dimensions: DimensionResult[];
  strengths: Strength[];
  findings: Finding[];
  agreement: AgreementRow[];
  notMeasurable: NotMeasurableItem[];
  pathToGreen: PathToGreen;
  notes: string[];
}

/* -------------------------------- API -------------------------------- */

export interface ParticipantProgress {
  id: string;
  role: 'rater' | 'consolidator';
  provider: string;
  model: string;
  family: string;
  status: ParticipantStatus;
  error?: string;
  latencyMs?: number;
}

export interface RunProgress {
  participants: ParticipantProgress[];
}

export interface RunSummary {
  id: string;
  projectId: string;
  projectName: string;
  iteration: number;
  status: RunStatus;
  stage: RunStage;
  gate: Gate | null;
  scorecardId: string | null;
  artifactName: string | null;
  weightedScore: number | null;
  agentDecision: Decision | null;
  finalDecision: Decision | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RunDetail extends RunSummary {
  progress: RunProgress | null;
  error: string | null;
  report: Report | null;
  evidence: HumanEvidence[];
  runLog: RunLog | null;
}

export interface RunLog {
  appVersion: string;
  nodeVersion: string;
  promptVersion: string;
  promptHashes: Record<string, string>;
  settings: { temperature: number; maxOutputTokens: number };
  models: ModelRef[];
  artifactHash: string;
  scorecardHash: string;
  timings: { totalMs: number; checksMs: number; ratingMs: number; consolidationMs: number };
  participants: Array<{
    id: string;
    role: 'rater' | 'consolidator';
    status: ParticipantStatus;
    attempts: number;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
    discarded: number;
    error?: string;
  }>;
}

export interface ProjectSummary {
  id: string;
  name: string;
  step: string | null;
  runCount: number;
  latest: RunSummary | null;
  scores: Array<number | null>;
}

export interface TrendPoint {
  runId: string;
  iteration: number;
  score: number | null;
  decision: Decision | null;
  createdAt: string;
}

export interface FindingDiff {
  runId: string;
  iteration: number;
  fixed: number;
  stillOpen: number;
  added: number;
}

export interface DimensionTrendRow {
  dimensionId: string;
  name: string;
  critical: boolean;
  scores: Array<number | null>;
}

export interface ProjectHistory {
  project: { id: string; name: string; step: string | null };
  runs: RunSummary[];
  trend: TrendPoint[];
  dimensions: DimensionTrendRow[];
  findingDiffs: FindingDiff[];
  thresholds: { accept: number; refine: number } | null;
}

export interface RosterProblem {
  level: 'error' | 'warning';
  message: string;
}

export interface ConfigResponse {
  mock: boolean;
  raters: Array<ModelRef & { keyPresent: boolean; approved: boolean }>;
  consolidator: ModelRef & { keyPresent: boolean; approved: boolean };
  problems: RosterProblem[];
  ready: boolean;
  promptVersion: string;
  thresholds: { accept: number; refine: number };
}
