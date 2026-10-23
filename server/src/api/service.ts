import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParticipantProgress, RunProgress } from '@ddd/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/store.js';
import { evaluate, preflight, type ProgressEvent } from '../agent/index.js';
import { serializeSheets } from '../excel/serialize.js';
import { resolvePageRanges } from '../excel/pageRanges.js';
import { WorkbookModel } from '../excel/workbook.js';
import { assertRosterReady, inspectRoster, usableFallbacks } from '../llm/roster.js';
import type { ProviderFactory } from '../llm/registry.js';
import { saveRunSnapshot } from './snapshot.js';
import { approveDraft, importCandidates, importWithFallbacks, type ImportInput, type ImportResult } from '../scorecard/importer.js';
import { parseScorecardFile } from '../scorecard/parse.js';
import { sha256 } from '../util/hash.js';
import { UserError, errorMessage } from '../util/errors.js';

export interface SubmitInput {
  workbook: { name: string; buffer: Buffer };
  scorecard: { name: string; buffer: Buffer };
  sources: string;
  /** Extra instructions for the examiners (the "prompt box"). */
  instructions?: string;
  projectName?: string;
}

export interface ServiceDeps {
  store: Store;
  config: AppConfig;
  providers: ProviderFactory;
  env: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

export const MAX_INSTRUCTIONS = 4000;

const safeName = (name: string) => path.basename(name).replace(/[^\w.\- ]+/g, '_') || 'workbook.xlsx';

/**
 * Accepts a submission, checks it straight away so mistakes come back as a clear error,
 * then evaluates in the background while the dashboard follows the progress.
 */
export class EvaluationService {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly deps: ServiceDeps) {}

  /**
   * Drafts a scorecard in this app's format from a scorecard in any layout. The model that reads it is the first rater
   * without a prompt-size limit (the most room), else the consolidator. The draft is never frozen.
   */
  async importScorecard(input: ImportInput): Promise<ImportResult> {
    const candidates = importCandidates(this.deps.config.models, this.deps.providers);
    if (candidates.length === 0) throw new UserError('No model is ready to read the scorecard. Check the keys with "npm run models:check".', 409);
    return importWithFallbacks(input, candidates);
  }

  approveScorecard(yamlText: string, approvedBy?: string) {
    return approveDraft(yamlText, approvedBy);
  }

  async submit(input: SubmitInput): Promise<{ runId: string; projectId: string; iteration: number }> {
    const { scorecard: parsed, hash } = await parseScorecardFile(input.scorecard.buffer, input.scorecard.name);
    const instructions = (input.instructions ?? '').trim();
    if (instructions.length > MAX_INSTRUCTIONS) {
      throw new UserError(`The extra instructions are ${instructions.length} characters; the limit is ${MAX_INSTRUCTIONS}. Shorten them.`);
    }
    if (!parsed.frozen) {
      throw new UserError('This scorecard is not frozen. Set `frozen: true` once it is approved, so the target cannot move mid-evaluation.');
    }
    const roster = inspectRoster(this.deps.config.models, this.deps.env);
    assertRosterReady(roster);

    const wb = await WorkbookModel.load(input.workbook.buffer);
    const scorecard = resolvePageRanges(parsed, wb);
    for (const sheet of [...scorecard.artifact.sheets, ...scorecard.artifact.context]) {
      if (!wb.resolveSheet(sheet.name)) {
        throw new UserError(`The scorecard names a sheet "${sheet.name}" that this workbook does not have. Sheets found: ${wb.sheetNames().join(', ')}`);
      }
    }

    // Column lists are checked now too, so a typo comes back as an error, not as a failed run.
    serializeSheets(wb, [...scorecard.artifact.sheets, ...scorecard.artifact.context]);

    // Refuse now, in plain words, an evaluation that most of the raters could not take, instead of failing three calls later.
    const fit = preflight({
      scorecard, wb, sources: input.sources, instructions,
      raters: roster.raters.map((r) => ({
        id: r.id, model: r.model, maxInputTokens: r.maxInputTokens,
        fallbackLimits: usableFallbacks(r).map((f) => f.maxInputTokens),
      })),
    });
    if (!fit.ok) throw new UserError(fit.problem!, 409);

    const runId = randomUUID();
    const name = safeName(input.workbook.name);
    const folder = path.join(this.deps.config.dataDir, 'uploads', runId);
    await mkdir(folder, { recursive: true });
    const workbookPath = path.join(folder, name);
    await writeFile(workbookPath, input.workbook.buffer, { flag: 'wx' });

    const projectName = (input.projectName?.trim() || path.basename(name, path.extname(name))).slice(0, 120);
    const progress: RunProgress = {
      participants: [...roster.raters.map((r) => ({ ...r, role: 'rater' as const })), { ...roster.consolidator, role: 'consolidator' as const }].map(
        (m): ParticipantProgress => ({ id: m.id, role: m.role, provider: m.provider, model: m.model, family: m.family, status: 'waiting' }),
      ),
    };

    const created = await this.deps.store.createRun(
      {
        projectName, step: parsed.step, gate: parsed.gate, scorecard: parsed, scorecardHash: hash, sources: input.sources, instructions,
        artifactName: name, artifactHash: sha256(input.workbook.buffer), artifactPath: workbookPath, progress,
      },
      runId,
    );

    const job = this.execute(created.runId, projectName, created.iteration, workbookPath, name, input.sources, instructions, parsed, hash, progress)
      .catch((error) => this.deps.log?.(`run ${runId} crashed: ${errorMessage(error)}`))
      .finally(() => this.running.delete(job));
    this.running.add(job);
    return created;
  }

  /** Saves a copy of the run's report as files. A failure here is logged and never loses the result held in the database. */
  async snapshot(runId: string): Promise<void> {
    try {
      const folder = await saveRunSnapshot(this.deps.config.dataDir, await this.deps.store.getRunDetail(runId));
      if (folder) this.deps.log?.(`report saved to ${folder}`);
    } catch (error) {
      this.deps.log?.(`could not save report files: ${errorMessage(error)}`);
    }
  }

  /** Resolves when every started evaluation has finished (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }

  private async execute(
    runId: string,
    projectName: string,
    iteration: number,
    workbookPath: string,
    artifactName: string,
    sources: string,
    instructions: string,
    scorecard: Parameters<typeof evaluate>[0]['scorecard'],
    scorecardHash: string,
    progress: RunProgress,
  ): Promise<void> {
    const { store, config, providers, env } = this.deps;
    // Progress writes are queued so they reach the database in the order they happened.
    let chain: Promise<unknown> = Promise.resolve();
    const persist = (work: () => Promise<void>) => {
      chain = chain.then(work).catch((error) => this.deps.log?.(`progress write failed: ${errorMessage(error)}`));
    };

    const onProgress = (event: ProgressEvent) => {
      if (event.type === 'stage') {
        persist(() => store.setStage(runId, event.stage, progress));
        return;
      }
      const participant = progress.participants.find((p) => p.id === event.id);
      if (!participant) return;
      participant.status = event.status;
      if (event.provider) participant.provider = event.provider;
      if (event.model) participant.model = event.model;
      participant.error = event.error;
      participant.latencyMs = event.latencyMs;
      persist(() => store.setProgress(runId, progress));
    };

    try {
      const output = await evaluate({
        runId, projectName, iteration, workbookPath, artifactName, scorecard, scorecardHash, sources, instructions,
        models: config.models, providers, env, onProgress,
      });
      await chain;
      await store.completeRun(runId, output, progress);
      await this.snapshot(runId);
    } catch (error) {
      await chain;
      await store.failRun(runId, errorMessage(error));
    }
  }
}
