import { readFile } from 'node:fs/promises';
import type {
  DimensionResult,
  EvaluationCore,
  ModelRef,
  ParticipantStatus,
  RunLog,
  RunStage,
  Scorecard,
} from '@ddd/shared';
import { runCodeChecks } from './checks/index.js';
import type { ModelsConfig } from '../config.js';
import { WorkbookModel } from '../excel/workbook.js';
import { inspectRoster, assertRosterReady } from '../llm/roster.js';
import type { ProviderFactory } from '../llm/registry.js';
import { candidatesFor, describeFailures, runWithFallback } from './fallback.js';
import { buildRaterPrompt } from './prompt.js';
import { PROMPT_VERSION } from './prompts/rater.js';
import { buildConsolidatorUser } from './prompts/consolidator.js';
import { sha256 } from '../util/hash.js';
import { UserError } from '../util/errors.js';
import { buildRaterResultsJson, consolidate } from './consolidate.js';
import { defaultReturnTo, finalizeFindings, findingsFromChecks } from './findings.js';
import { runRater } from './rater.js';
import type { CallMeta, DraftFinding, RaterOutcome } from './types.js';

export type ProgressEvent =
  | { type: 'stage'; stage: RunStage }
  | { type: 'participant'; id: string; status: ParticipantStatus; error?: string; latencyMs?: number; provider?: string; model?: string };

export interface EvaluateArgs {
  runId: string;
  projectName: string;
  iteration: number;
  workbookPath: string;
  artifactName: string;
  scorecard: Scorecard;
  scorecardHash: string;
  sources: string;
  /** Extra instructions from the person submitting the work. Recorded in the report header. */
  instructions?: string;
  models: ModelsConfig;
  providers: ProviderFactory;
  env?: NodeJS.ProcessEnv;
  onProgress?: (event: ProgressEvent) => void;
  now?: () => Date;
}

export interface EvaluationOutput {
  core: EvaluationCore;
  /** Raters first, then the consolidator, with prompts and raw replies for the run log. */
  calls: Array<CallMeta & { discarded: number; discardedDetail: RaterOutcome['discarded'] }>;
  runLog: RunLog;
}

const APP_VERSION = '1.0.0';

/**
 * One evaluation, start to finish. It follows the Level 1 flow on PDF page 9:
 * freeze the inputs, score the countable dimensions in code, let three blind raters
 * score the rest, consolidate, then apply the decision rule. It never writes to the workbook.
 */
export async function evaluate(args: EvaluateArgs): Promise<EvaluationOutput> {
  const now = args.now ?? (() => new Date());
  const startedAt = now();
  const emit = args.onProgress ?? (() => undefined);
  const { scorecard } = args;
  const instructions = (args.instructions ?? '').trim();

  if (!scorecard.frozen) {
    throw new UserError(
      'The scorecard is not frozen. A scorecard must be frozen (frozen: true) before anything is scored against it, so the target cannot move.',
    );
  }
  const roster = inspectRoster(args.models, args.env);
  assertRosterReady(roster);

  /* 1. Freeze: read once, hash, and check the sheets the scorecard names exist. */
  emit({ type: 'stage', stage: 'reading' });
  const bytes = await readFile(args.workbookPath);
  const artifactHash = sha256(bytes);
  const wb = await WorkbookModel.load(bytes);
  const artifactSheets = scorecard.artifact.sheets.map((s) => s.name);
  const contextSheets = scorecard.artifact.context.map((s) => s.name);
  for (const name of [...artifactSheets, ...contextSheets]) {
    if (!wb.resolveSheet(name)) {
      throw new UserError(`Sheet "${name}" named by the scorecard was not found. Sheets in this file: ${wb.sheetNames().join(', ')}`);
    }
  }
  const allowedSheets = new Set([...artifactSheets, ...contextSheets].map((n) => wb.resolveSheet(n)!.toLowerCase()));

  /* 2. Countable dimensions, scored by code. */
  emit({ type: 'stage', stage: 'checks' });
  const checkStarted = Date.now();
  const codeOutcomes = runCodeChecks(scorecard, wb);
  const checksMs = Date.now() - checkStarted;

  /* 3. Blind rating by three models. */
  const raterRefs: ModelRef[] = roster.raters.map(({ id, provider, model, family }) => ({ id, provider, model, family }));
  const consolidatorRef: ModelRef = {
    id: roster.consolidator.id,
    provider: roster.consolidator.provider,
    model: roster.consolidator.model,
    family: roster.consolidator.family,
  };
  const settings = { temperature: args.models.settings.temperature, maxOutputTokens: args.models.settings.maxOutputTokens };
  const returnTo = defaultReturnTo(scorecard.gate);

  const { rated, artifactText, user: raterUser } = buildRaterPrompt({ scorecard, wb, sources: args.sources, instructions });

  const fallbackNotes: string[] = [];
  const ratingStarted = Date.now();
  let outcomes: RaterOutcome[] = [];
  if (rated.length > 0) {
    emit({ type: 'stage', stage: 'rating' });
    outcomes = await Promise.all(
      roster.raters.map(async (member) => {
        const candidates = candidatesFor(member);
        emit({ type: 'participant', id: member.id, status: 'running', provider: member.provider, model: member.model });
        const { result: outcome, failures } = await runWithFallback(
          candidates,
          (candidate) => {
            if (candidate !== candidates[0]) {
              emit({ type: 'participant', id: member.id, status: 'running', provider: candidate.ref.provider, model: candidate.ref.model });
            }
            return runRater({
              model: candidate.ref,
              provider: args.providers(candidate.ref.provider),
              user: raterUser,
              expected: rated,
              wb,
              allowedSheets,
              defaultReturnTo: returnTo,
              settings,
              maxInputTokens: candidate.maxInputTokens,
            });
          },
          (o) => ({ ok: o.status === 'ok', error: o.error }),
        );
        if (failures.length > 0) {
          if (outcome.status === 'ok') {
            fallbackNotes.push(`Rater ${member.id}: ${describeFailures(failures)}. ${outcome.model.model} answered instead (same model family).`);
          } else {
            outcome.error = describeFailures(failures);
          }
        }
        emit({ type: 'participant', id: member.id, status: outcome.status, error: outcome.error, latencyMs: outcome.latencyMs, provider: outcome.model.provider, model: outcome.model.model });
        return outcome;
      }),
    );
    if (outcomes.every((o) => o.status === 'failed')) {
      const why = outcomes.map((o) => `${o.model.id}: ${o.error}`).join('; ');
      throw new Error(`All three raters failed, so nothing can be scored. ${why}`);
    }
  }
  const ratingMs = Date.now() - ratingStarted;

  /* 4. Consolidation. */
  const consolidationStarted = Date.now();
  let consolidatedDims: DimensionResult[] = [];
  let raterFindings: DraftFinding[] = [];
  let consolidation: Awaited<ReturnType<typeof consolidate>> | null = null;
  if (rated.length > 0) {
    emit({ type: 'stage', stage: 'consolidating' });
    emit({ type: 'participant', id: consolidatorRef.id, status: 'running', provider: roster.consolidator.provider, model: roster.consolidator.model });
    const consolidatorCandidates = candidatesFor(roster.consolidator);
    const consolidatorUser = buildConsolidatorUser({
      scorecard,
      dimensions: rated,
      raterResults: buildRaterResultsJson(rated, outcomes),
      artifactText,
      instructions,
    });
    const { result, failures } = await runWithFallback(
      consolidatorCandidates,
      (candidate) => {
        if (candidate !== consolidatorCandidates[0]) {
          emit({ type: 'participant', id: consolidatorRef.id, status: 'running', provider: candidate.ref.provider, model: candidate.ref.model });
        }
        return consolidate({
          model: candidate.ref,
          provider: args.providers(candidate.ref.provider),
          rated,
          outcomes,
          user: consolidatorUser,
          wb,
          allowedSheets,
          defaultReturnTo: returnTo,
          settings,
        });
      },
      (r) => ({ ok: r.call.status === 'ok', error: r.call.error }),
    );
    consolidation = result;
    if (failures.length > 0) {
      if (consolidation.call.status === 'ok') {
        fallbackNotes.push(`Consolidator: ${describeFailures(failures)}. ${consolidation.call.model.model} answered instead.`);
      } else {
        consolidation.call.error = describeFailures(failures);
      }
    }
    emit({
      type: 'participant',
      id: consolidatorRef.id,
      status: consolidation.call.status,
      error: consolidation.call.error,
      latencyMs: consolidation.call.latencyMs,
      provider: consolidation.call.model.provider,
      model: consolidation.call.model.model,
    });
    consolidatedDims = consolidation.dimensions;
    raterFindings = consolidation.findings;
  }
  const consolidationMs = Date.now() - consolidationStarted;

  /* 5. Assemble every dimension in scorecard order, then the findings. */
  emit({ type: 'stage', stage: 'reporting' });
  const byId = new Map<string, DimensionResult>();
  for (const { result } of codeOutcomes) byId.set(result.id, result);
  for (const dim of consolidatedDims) byId.set(dim.id, dim);
  const dimensions = scorecard.dimensions.map((spec): DimensionResult => {
    return (
      byId.get(spec.id) ?? {
        id: spec.id,
        name: spec.name,
        weight: spec.weight,
        critical: spec.critical,
        measuredBy: 'human',
        status: 'not_measurable',
        raterScores: {},
        consolidated: null,
        spread: null,
        resolution: 'none',
        flagged: false,
        rationale: spec.needs ?? 'Only a person can provide this evidence.',
        evidence: [],
      }
    );
  });
  const findings = finalizeFindings(scorecard, [...findingsFromChecks(scorecard, codeOutcomes), ...raterFindings]);

  /* 6. Freeze check: the file must be exactly what we hashed at the start. */
  const after = sha256(await readFile(args.workbookPath));
  if (after !== artifactHash) {
    throw new Error('The workbook changed while it was being evaluated. Nothing was reported; submit it again.');
  }

  const calls: EvaluationOutput['calls'] = [
    ...outcomes.map((o) => ({ ...o, discarded: o.discarded.length, discardedDetail: o.discarded })),
    ...(consolidation ? [{ ...consolidation.call, discarded: 0, discardedDetail: [] }] : []),
  ];

  const notes: string[] = [...fallbackNotes];
  // The report names the models that actually answered, which differ from the roster when a fallback was used.
  const usedRaters: ModelRef[] = outcomes.length > 0 ? outcomes.map((o) => o.model) : raterRefs;
  const usedConsolidator: ModelRef = consolidation?.call.model ?? consolidatorRef;
  for (const o of outcomes) {
    if (o.status === 'failed') notes.push(`Rater ${o.model.id} (${o.model.model}) failed and was left out: ${o.error}`);
    else if (o.discarded.length > 0) notes.push(`Rater ${o.model.id} had ${o.discarded.length} claim(s) discarded for missing or unsupported evidence.`);
  }
  if (consolidation?.consolidatorFailed) {
    notes.push(`The consolidator failed (${consolidation.call.error}). The lower rater score was used wherever raters differed, and those items are flagged for a person.`);
  }
  if (rated.length === 0) notes.push('This scorecard has no rater dimensions, so only code checks were run.');

  const finishedAt = now();
  const core: EvaluationCore = {
    header: {
      runId: args.runId,
      projectName: args.projectName,
      iteration: args.iteration,
      step: scorecard.step,
      gate: scorecard.gate,
      artifactName: args.artifactName,
      artifactHash,
      scorecardId: scorecard.id,
      scorecardName: scorecard.name,
      scorecardVersion: scorecard.version,
      scorecardHash: args.scorecardHash,
      scorecardApproval: scorecard.approval,
      raters: usedRaters,
      consolidator: usedConsolidator,
      promptVersion: PROMPT_VERSION,
      ...(instructions ? { instructions, instructionsHash: sha256(instructions) } : {}),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
    },
    scorecard,
    dimensions,
    findings,
    strengths: consolidation?.strengths ?? [],
    consolidatorFailed: consolidation?.consolidatorFailed ?? false,
    notes,
  };

  const runLog: RunLog = {
    appVersion: APP_VERSION,
    nodeVersion: process.version,
    promptVersion: PROMPT_VERSION,
    promptHashes: Object.fromEntries(calls.map((c) => [c.model.id, c.promptHash])),
    settings,
    models: [...usedRaters, usedConsolidator],
    artifactHash,
    scorecardHash: args.scorecardHash,
    timings: { totalMs: finishedAt.getTime() - startedAt.getTime(), checksMs, ratingMs, consolidationMs },
    participants: calls.map((c) => ({
      id: c.model.id,
      role: c.role,
      status: c.status,
      attempts: c.attempts,
      latencyMs: c.latencyMs,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      discarded: c.discarded,
      error: c.error,
    })),
  };
  return { core, calls, runLog };
}
