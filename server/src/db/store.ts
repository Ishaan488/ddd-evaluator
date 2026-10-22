import { randomUUID } from 'node:crypto';
import type {
  Decision,
  DimensionTrendRow,
  EvaluationCore,
  Finding,
  FindingDiff,
  Gate,
  HumanEvidence,
  Override,
  ProjectHistory,
  ProjectSummary,
  RunDetail,
  RunLog,
  RunProgress,
  RunStage,
  RunStatus,
  RunSummary,
  Scorecard,
} from '@ddd/shared';
import { assembleReport } from '../report/assemble.js';
import type { EvaluationOutput } from '../agent/index.js';
import { UserError } from '../util/errors.js';
import type { Db } from './pool.js';

const iso = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value));
const isoOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : iso(value));
const json = (value: unknown): string => JSON.stringify(value);
const parseJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
};

interface RunRow {
  id: string;
  project_id: string;
  project_name: string;
  iteration: number;
  status: RunStatus;
  stage: RunStage;
  gate: Gate | null;
  scorecard_id: string | null;
  artifact_name: string | null;
  artifact_path: string | null;
  weighted_score: number | null;
  agent_decision: Decision | null;
  final_decision: Decision | null;
  created_at: unknown;
  finished_at: unknown;
  progress: unknown;
  error: string | null;
  core: unknown;
  run_log: unknown;
  scorecard: unknown;
}

const RUN_COLUMNS = `r.id, r.project_id, p.name as project_name, r.iteration, r.status, r.stage, r.gate, r.scorecard_id,
  r.artifact_name, r.artifact_path, r.weighted_score, r.agent_decision, r.final_decision, r.created_at, r.finished_at,
  r.progress, r.error, r.core, r.run_log, r.scorecard`;

function toSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    iteration: Number(row.iteration),
    status: row.status,
    stage: row.stage,
    gate: row.gate,
    scorecardId: row.scorecard_id,
    artifactName: row.artifact_name,
    weightedScore: row.weighted_score === null ? null : Number(row.weighted_score),
    agentDecision: row.agent_decision,
    finalDecision: row.final_decision,
    createdAt: iso(row.created_at),
    finishedAt: isoOrNull(row.finished_at),
  };
}

export interface NewRun {
  projectName: string;
  step?: string;
  gate: Gate;
  scorecard: Scorecard;
  scorecardHash: string;
  sources: string;
  artifactName: string;
  artifactHash: string;
  artifactPath: string;
  progress: RunProgress;
}

export class Store {
  constructor(private readonly db: Db) {}

  /* ------------------------------ runs ------------------------------ */

  /** Creates the project if needed and the next iteration of it, in one transaction. */
  async createRun(input: NewRun, runId = randomUUID()): Promise<{ runId: string; projectId: string; iteration: number }> {
    return this.db.tx(async (tx) => {
      let [project] = await tx.query<{ id: string }>('select id from projects where name = $1', [input.projectName]);
      if (!project) {
        project = { id: randomUUID() };
        await tx.query('insert into projects (id, name, step) values ($1, $2, $3)', [project.id, input.projectName, input.step ?? null]);
      }
      const [last] = await tx.query<{ last: number | null }>('select max(iteration) as last from runs where project_id = $1', [project.id]);
      const iteration = Number(last?.last ?? 0) + 1;
      await tx.query(
        `insert into runs (id, project_id, iteration, status, stage, gate, scorecard_id, scorecard_version, scorecard_hash,
           scorecard, sources, artifact_name, artifact_hash, artifact_path, progress)
         values ($1,$2,$3,'queued','queued',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          runId, project.id, iteration, input.gate, input.scorecard.id, input.scorecard.version, input.scorecardHash,
          json(input.scorecard), input.sources, input.artifactName, input.artifactHash, input.artifactPath, json(input.progress),
        ],
      );
      return { runId, projectId: project.id, iteration };
    });
  }

  async setStage(runId: string, stage: RunStage, progress?: RunProgress): Promise<void> {
    const status: RunStatus = stage === 'queued' ? 'queued' : 'running';
    if (progress) {
      await this.db.query('update runs set stage = $2, status = $3, progress = $4 where id = $1', [runId, stage, status, json(progress)]);
    } else {
      await this.db.query('update runs set stage = $2, status = $3 where id = $1', [runId, stage, status]);
    }
  }

  async setProgress(runId: string, progress: RunProgress): Promise<void> {
    await this.db.query('update runs set progress = $2 where id = $1', [runId, json(progress)]);
  }

  async failRun(runId: string, message: string): Promise<void> {
    await this.db.query(
      `update runs set status = 'failed', stage = 'failed', error = $2, finished_at = now() where id = $1`,
      [runId, message],
    );
  }

  /** On start-up, a run left "running" by a crashed process can never finish: mark it failed. */
  async failInterrupted(): Promise<number> {
    const rows = await this.db.query<{ id: string }>(`select id from runs where status in ('queued', 'running')`);
    for (const row of rows) await this.failRun(row.id, 'The server stopped before this evaluation finished. Submit it again.');
    return rows.length;
  }

  async completeRun(runId: string, output: EvaluationOutput, progress: RunProgress): Promise<void> {
    const { core, calls, runLog } = output;
    const report = assembleReport(core, [], null);
    await this.db.tx(async (tx) => {
      await tx.query(
        `update runs set status = 'done', stage = 'done', core = $2, run_log = $3, progress = $4,
           weighted_score = $5, agent_decision = $6, final_decision = $6, finished_at = now() where id = $1`,
        [runId, json(core), json(runLog), json(progress), report.verdict.weightedScore, report.verdict.agentDecision],
      );

      for (const call of calls) {
        await tx.query(
          `insert into model_calls (run_id, participant_id, role, provider, model, family, status, attempts, prompt_hash,
             prompt, raw_response, discarded, input_tokens, output_tokens, latency_ms, error)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            runId, call.model.id, call.role, call.model.provider, call.model.model, call.model.family, call.status,
            call.attempts, call.promptHash, call.prompt, call.rawResponse, json(call.discardedDetail),
            call.inputTokens, call.outputTokens, Math.round(call.latencyMs), call.error ?? null,
          ],
        );
      }

      for (const dim of core.dimensions) {
        await tx.query(
          `insert into dimension_scores (run_id, dimension_id, name, weight, critical, measured_by, status, score, spread,
             resolution, flagged, rater_scores) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            runId, dim.id, dim.name, dim.weight, dim.critical, dim.measuredBy, dim.status, dim.consolidated, dim.spread,
            dim.resolution, dim.flagged, json(dim.raterScores),
          ],
        );
      }

      for (const f of core.findings) {
        await tx.query(
          `insert into findings (run_id, finding_id, fingerprint, severity, dimension_id, sheet, cell, title, detail, fix,
             return_to, source, reported_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            runId, f.id, fingerprint(f), f.severity, f.dimensionId, f.location?.sheet ?? null,
            f.location?.cell ?? null, f.title, f.detail, f.fix, f.returnTo, f.source, f.reportedBy.join(','),
          ],
        );
      }
    });
  }

  private async row(runId: string): Promise<RunRow> {
    const [row] = await this.db.query<RunRow>(
      `select ${RUN_COLUMNS} from runs r join projects p on p.id = r.project_id where r.id = $1`,
      [runId],
    );
    if (!row) throw new UserError('That run does not exist.', 404);
    return row;
  }

  async getArtifactPath(runId: string): Promise<string | null> {
    return (await this.row(runId)).artifact_path;
  }

  async getRunDetail(runId: string): Promise<RunDetail> {
    const row = await this.row(runId);
    const evidence = await this.evidence(runId);
    const override = await this.latestOverride(runId);
    const core = parseJson<EvaluationCore>(row.core);
    return {
      ...toSummary(row),
      progress: parseJson<RunProgress>(row.progress),
      error: row.error,
      report: core ? assembleReport(core, evidence, override) : null,
      evidence,
      runLog: parseJson<RunLog>(row.run_log),
    };
  }

  /* ------------------------ human input ------------------------ */

  async evidence(runId: string): Promise<HumanEvidence[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'select id, run_id, dimension_id, score, note, by_name, created_at from human_evidence where run_id = $1 order by created_at',
      [runId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      runId: String(r.run_id),
      dimensionId: String(r.dimension_id),
      score: r.score === null ? null : Number(r.score),
      note: String(r.note),
      by: String(r.by_name),
      createdAt: iso(r.created_at),
    }));
  }

  async latestOverride(runId: string): Promise<Override | null> {
    const [r] = await this.db.query<Record<string, unknown>>(
      'select id, run_id, decision, reason, by_name, created_at from overrides where run_id = $1 order by created_at desc',
      [runId],
    );
    return r
      ? { id: String(r.id), runId: String(r.run_id), decision: r.decision as Decision, reason: String(r.reason), by: String(r.by_name), createdAt: iso(r.created_at) }
      : null;
  }

  async addEvidence(runId: string, input: { dimensionId: string; score: number | null; note: string; by: string }): Promise<void> {
    const detail = await this.requireDone(runId);
    const dim = detail.report!.notMeasurable.find((n) => n.dimensionId === input.dimensionId);
    if (!dim) throw new UserError(`${input.dimensionId} is not a human-only item in this report.`);
    await this.db.query(
      'insert into human_evidence (id, run_id, dimension_id, score, note, by_name) values ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), runId, input.dimensionId, input.score, input.note, input.by],
    );
    await this.refreshVerdict(runId);
  }

  async addOverride(runId: string, input: { decision: Decision; reason: string; by: string }): Promise<void> {
    await this.requireDone(runId);
    await this.db.query('insert into overrides (id, run_id, decision, reason, by_name) values ($1,$2,$3,$4,$5)', [
      randomUUID(), runId, input.decision, input.reason, input.by,
    ]);
    await this.refreshVerdict(runId);
  }

  private async requireDone(runId: string): Promise<RunDetail> {
    const detail = await this.getRunDetail(runId);
    if (detail.status !== 'done' || !detail.report) throw new UserError('This run has no finished report yet.', 409);
    return detail;
  }

  /** Keeps the columns people query in step with the live verdict. */
  private async refreshVerdict(runId: string): Promise<void> {
    const detail = await this.getRunDetail(runId);
    if (!detail.report) return;
    const { verdict } = detail.report;
    await this.db.query('update runs set weighted_score = $2, agent_decision = $3, final_decision = $4 where id = $1', [
      runId, verdict.weightedScore, verdict.agentDecision, verdict.decision,
    ]);
  }

  /* ---------------------------- projects ---------------------------- */

  async listProjects(): Promise<ProjectSummary[]> {
    const projects = await this.db.query<{ id: string; name: string; step: string | null; created_at: unknown }>(
      'select id, name, step, created_at from projects order by created_at desc',
    );
    const out: ProjectSummary[] = [];
    for (const project of projects) {
      const runs = await this.runsOf(project.id);
      const latest = runs.length > 0 ? runs[runs.length - 1]! : null;
      out.push({
        id: project.id,
        name: project.name,
        step: project.step,
        runCount: runs.length,
        latest,
        scores: runs.filter((r) => r.status === 'done').map((r) => r.weightedScore).slice(-12),
      });
    }
    return out.sort((a, b) => (b.latest?.createdAt ?? '').localeCompare(a.latest?.createdAt ?? ''));
  }

  private async runsOf(projectId: string): Promise<RunSummary[]> {
    const rows = await this.db.query<RunRow>(
      `select ${RUN_COLUMNS} from runs r join projects p on p.id = r.project_id where r.project_id = $1 order by r.iteration`,
      [projectId],
    );
    return rows.map(toSummary);
  }

  async getHistory(projectId: string): Promise<ProjectHistory> {
    const [project] = await this.db.query<{ id: string; name: string; step: string | null }>(
      'select id, name, step from projects where id = $1',
      [projectId],
    );
    if (!project) throw new UserError('That project does not exist.', 404);

    const runs = await this.runsOf(projectId);
    const done = runs.filter((r) => r.status === 'done');

    const dimensionRows = new Map<string, DimensionTrendRow>();
    const findingSets = new Map<string, Set<string>>();
    for (const [index, run] of done.entries()) {
      const scores = await this.db.query<{ dimension_id: string; name: string; critical: boolean; score: number | null }>(
        'select dimension_id, name, critical, score from dimension_scores where run_id = $1',
        [run.id],
      );
      for (const s of scores) {
        const row = dimensionRows.get(s.dimension_id) ?? {
          dimensionId: s.dimension_id, name: s.name, critical: Boolean(s.critical), scores: done.map(() => null),
        };
        row.scores[index] = s.score === null ? null : Number(s.score);
        dimensionRows.set(s.dimension_id, row);
      }
      const fingerprints = await this.db.query<{ fingerprint: string }>('select fingerprint from findings where run_id = $1', [run.id]);
      findingSets.set(run.id, new Set(fingerprints.map((f) => f.fingerprint)));
    }

    const findingDiffs: FindingDiff[] = done.map((run, index) => {
      const current = findingSets.get(run.id)!;
      const previous = index > 0 ? findingSets.get(done[index - 1]!.id)! : new Set<string>();
      const stillOpen = [...current].filter((f) => previous.has(f)).length;
      return {
        runId: run.id,
        iteration: run.iteration,
        fixed: index === 0 ? 0 : [...previous].filter((f) => !current.has(f)).length,
        stillOpen,
        added: current.size - stillOpen,
      };
    });

    const latest = done[done.length - 1];
    const scorecard = latest ? parseJson<Scorecard>((await this.row(latest.id)).scorecard) : null;
    // Rows follow the scorecard's own order; a dimension that only older iterations had goes last.
    const position = new Map((scorecard?.dimensions ?? []).map((d, i) => [d.id, i]));
    const dimensions = [...dimensionRows.values()].sort(
      (a, b) => (position.get(a.dimensionId) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.dimensionId) ?? Number.MAX_SAFE_INTEGER),
    );
    return {
      project,
      runs,
      trend: done.map((r) => ({ runId: r.id, iteration: r.iteration, score: r.weightedScore, decision: r.finalDecision, createdAt: r.createdAt })),
      dimensions,
      findingDiffs,
      thresholds: scorecard?.thresholds ?? null,
    };
  }
}

/**
 * Identity of a finding across iterations, to tell "fixed" from "still open".
 * A code finding is the dimension itself (the failing cell moves as rows get fixed);
 * a rater finding is the dimension at a cell.
 */
export function fingerprint(finding: Pick<Finding, 'dimensionId' | 'location' | 'source'>): string {
  if (finding.source === 'code') return `${finding.dimensionId}|code`;
  return `${finding.dimensionId}|${finding.location?.sheet ?? ''}|${finding.location?.cell ?? ''}`;
}
