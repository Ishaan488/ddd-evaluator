import type {
  CellRef,
  Confidence,
  DimensionResult,
  DimensionSpec,
  Evidence,
  ModelRef,
  ReturnTo,
  Severity,
  Strength,
} from '@ddd/shared';
import { SEVERITY_ORDER } from '@ddd/shared';
import type { WorkbookModel } from '../excel/workbook.js';
import type { LlmProvider } from '../llm/types.js';
import { CONSOLIDATOR_SYSTEM } from './prompts/consolidator.js';
import { normalise } from '../util/text.js';
import { callJsonModel, extractJson, type CallSettings } from './callModel.js';
import { validateCitations } from './evidence.js';
import {
  consolidatorDimensionSchema,
  consolidatorFindingSchema,
  consolidatorReplySchema,
  strengthSchema,
} from './raterSchema.js';
import type { CallMeta, DraftFinding, RaterOutcome } from './types.js';

type ConsolidatorReply = ReturnType<typeof consolidatorReplySchema.parse>;

export interface ConsolidationInput {
  model: ModelRef;
  provider: LlmProvider;
  rated: DimensionSpec[];
  outcomes: RaterOutcome[];
  user: string;
  wb: WorkbookModel;
  allowedSheets: ReadonlySet<string>;
  defaultReturnTo: ReturnTo;
  settings: CallSettings;
}

export interface ConsolidationResult {
  call: CallMeta;
  dimensions: DimensionResult[];
  findings: DraftFinding[];
  strengths: Strength[];
  consolidatorFailed: boolean;
}

/** Dimensions where the usable raters differ by more than one point: the only ones whose claims the consolidator must check. */
export function disputedDimensions(rated: DimensionSpec[], outcomes: RaterOutcome[]): Set<string> {
  const ok = outcomes.filter((o) => o.status === 'ok');
  const disputed = new Set<string>();
  for (const spec of rated) {
    const scores = ok.flatMap((o) => {
      const score = o.dimensions.find((d) => d.id === spec.id)?.score;
      return typeof score === 'number' ? [score] : [];
    });
    if (scores.length > 1 && Math.max(...scores) - Math.min(...scores) > 1) disputed.add(spec.id);
  }
  return disputed;
}

/** The three raters' validated results, in the form the consolidator reads them. */
export function buildRaterResultsJson(rated: DimensionSpec[], outcomes: RaterOutcome[]): string {
  const ok = outcomes.filter((o) => o.status === 'ok');
  return JSON.stringify(
    {
      dimensions: rated.map((spec) => ({
        id: spec.id,
        ratings: ok.flatMap((outcome) => {
          const dim = outcome.dimensions.find((d) => d.id === spec.id);
          return dim && dim.score !== null
            ? [{ rater: outcome.model.id, score: dim.score, rationale: dim.rationale, evidence: dim.evidence }]
            : [];
        }),
        not_measurable_by: ok
          .filter((o) => o.dimensions.find((d) => d.id === spec.id)?.notMeasurable)
          .map((o) => o.model.id),
      })),
      findings: ok.flatMap((o) =>
        o.findings.map((f) => ({
          ref: f.ref,
          rater: f.raterId,
          dimension: f.dimensionId,
          severity: f.severity,
          title: f.title,
          detail: f.detail,
          location: f.location,
          fix: f.fix,
        })),
      ),
      strengths: ok.flatMap((o) =>
        o.strengths.map((s) => ({ rater: s.raterId, dimension: s.dimensionId, text: s.text, location: s.location })),
      ),
    },
    null,
    1,
  );
}

function parseReply(raw: string): ConsolidatorReply {
  const result = consolidatorReplySchema.safeParse(extractJson(raw));
  if (!result.success) throw new Error('the JSON does not have a "dimensions" list in the required shape');
  return result.data;
}

export async function consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
  const okRaters = input.outcomes.filter((o) => o.status === 'ok');
  const call =
    okRaters.length === 0
      ? {
          ok: false as const,
          value: undefined,
          error: 'No rater produced a result, so there is nothing to consolidate.',
          raw: '',
          attempts: 0,
          latencyMs: 0,
          inputTokens: null,
          outputTokens: null,
          promptHash: '',
        }
      : await callJsonModel({
          provider: input.provider,
          model: input.model.model,
          system: CONSOLIDATOR_SYSTEM,
          user: input.user,
          settings: input.settings,
          parse: parseReply,
        });

  const meta: CallMeta = {
    model: input.model,
    role: 'consolidator',
    status: call.ok ? 'ok' : 'failed',
    prompt: input.user,
    promptHash: call.promptHash,
    rawResponse: call.raw,
    attempts: call.attempts,
    latencyMs: call.latencyMs,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    error: call.error,
  };

  // If no rater produced anything there is nothing to reconcile; the dimensions come out unscored.
  const reply = okRaters.length > 0 && call.ok ? (call.value ?? null) : null;
  return {
    call: meta,
    dimensions: input.rated.map((spec) => reconcileDimension(spec, input, reply)),
    findings: mergeFindings(input, reply),
    strengths: mergeStrengths(input, reply),
    consolidatorFailed: okRaters.length > 0 && !call.ok,
  };
}

/* ----------------------------- dimensions ----------------------------- */

function reconcileDimension(
  spec: DimensionSpec,
  input: ConsolidationInput,
  reply: ConsolidatorReply | null,
): DimensionResult {
  const ok = input.outcomes.filter((o) => o.status === 'ok');
  const raterScores: Record<string, number | null> = {};
  const given: Array<{ raterId: string; score: number; rationale: string; evidence: Evidence[]; repeatSpread: number }> = [];
  let abstained = 0;

  for (const outcome of input.outcomes) {
    const dim = outcome.dimensions.find((d) => d.id === spec.id);
    raterScores[outcome.model.id] = dim?.score ?? null;
    if (outcome.status !== 'ok' || !dim) continue;
    if (dim.score !== null) given.push({ raterId: outcome.model.id, score: dim.score, rationale: dim.rationale, evidence: dim.evidence, repeatSpread: dim.repeatSpread ?? 0 });
    else if (dim.notMeasurable) abstained += 1;
  }

  const base: DimensionResult = {
    id: spec.id,
    name: spec.name,
    weight: spec.weight,
    critical: spec.critical,
    measuredBy: 'raters',
    status: 'scored',
    raterScores,
    consolidated: null,
    spread: null,
    resolution: 'none',
    flagged: false,
    rationale: '',
    evidence: [],
  };

  if (given.length === 0) {
    const notMeasurable = ok.length > 0 && abstained === ok.length;
    return {
      ...base,
      status: notMeasurable ? 'not_measurable' : 'unscored',
      flagged: true,
      rationale: notMeasurable
        ? 'The raters could not measure this dimension from the artifact. A person must supply it.'
        : 'No rater produced an evidence-backed score for this dimension. It counts as 0 until a person reviews it.',
    };
  }

  const scores = given.map((g) => g.score);
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const spread = high - low;
  const fromConsolidator = reply?.dimensions
    .map((item) => consolidatorDimensionSchema.safeParse(item))
    .flatMap((r) => (r.success ? [r.data] : []))
    .find((d) => d.id.trim().toLowerCase() === spec.id.toLowerCase());

  const proposed =
    fromConsolidator &&
    fromConsolidator.score !== null &&
    Number.isInteger(fromConsolidator.score) &&
    fromConsolidator.score >= low &&
    fromConsolidator.score <= high
      ? fromConsolidator.score
      : null;
  const consolidatorEvidence = fromConsolidator
    ? validateCitations(input.wb, input.allowedSheets, fromConsolidator.evidence).valid
    : [];

  let consolidated: number;
  let resolution: DimensionResult['resolution'];
  let flagged = false;

  if (given.length === 1) {
    consolidated = given[0]!.score;
    resolution = 'single_rater';
    flagged = true;
  } else if (spread <= 1) {
    consolidated = proposed ?? low;
    resolution = 'agreement';
  } else if (proposed !== null && fromConsolidator?.resolved && (proposed === low || consolidatorEvidence.length > 0)) {
    consolidated = proposed;
    resolution = 'claims_checked';
  } else {
    // PDF page 10: an unresolved disagreement keeps the lower score and goes to a person.
    consolidated = low;
    resolution = 'lower_stands';
    flagged = true;
  }

  // Steady: two or more examiners within a point of each other, and each stable across its own repeats.
  const unstable = given.some((g) => g.repeatSpread > 1);
  const confidence: Confidence = given.length === 1 ? 'single' : spread <= 1 && !unstable ? 'steady' : 'shaky';

  const supporting = given.find((g) => g.score === consolidated) ?? given[0]!;
  const evidence = consolidatorEvidence.length > 0 && proposed === consolidated ? consolidatorEvidence : supporting.evidence;
  return {
    ...base,
    consolidated,
    spread,
    resolution,
    flagged,
    confidence,
    rationale: (fromConsolidator?.rationale || supporting.rationale || '').trim(),
    evidence: evidence.slice(0, 5),
  };
}

/* ------------------------------- findings ------------------------------ */

const sameFinding = (a: DraftFinding, b: DraftFinding) =>
  a.dimensionId === b.dimensionId &&
  a.location?.sheet === b.location?.sheet &&
  a.location?.cell === b.location?.cell &&
  normalise(a.title) === normalise(b.title);

function mergeFindings(input: ConsolidationInput, reply: ConsolidatorReply | null): DraftFinding[] {
  const all = input.outcomes.filter((o) => o.status === 'ok').flatMap((o) => o.findings);
  const byRef = new Map(all.map((f) => [f.ref, f]));
  const used = new Set<string>();
  const merged: DraftFinding[] = [];

  for (const item of reply?.findings ?? []) {
    const parsed = consolidatorFindingSchema.safeParse(item);
    if (!parsed.success) continue;
    const members = parsed.data.from.flatMap((ref) => {
      const member = byRef.get(ref);
      return member && !used.has(ref) ? [member] : [];
    });
    if (members.length === 0) continue;
    members.forEach((m) => used.add(m.ref));

    const dimensionId = members[0]!.dimensionId;
    const stated = parsed.data.location ? validateCitations(input.wb, input.allowedSheets, [parsed.data.location]).valid[0] : undefined;
    const location: CellRef | null = stated ? { sheet: stated.sheet, cell: stated.cell } : members[0]!.location;
    // The highest severity of any member stands, so merging can never soften a finding.
    const severity = members.reduce<Severity>(
      (top, m) => (SEVERITY_ORDER[m.severity] > SEVERITY_ORDER[top] ? m.severity : top),
      parsed.data.severity,
    );
    merged.push({
      source: 'raters',
      dimensionId,
      severity,
      title: parsed.data.title,
      detail: parsed.data.detail || members[0]!.detail,
      fix: parsed.data.fix || members[0]!.fix,
      returnTo: parsed.data.return_to ?? members[0]!.returnTo,
      location,
      reportedBy: [...new Set(members.map((m) => m.raterId))].sort(),
    });
  }

  // Nothing a rater found is dropped silently: whatever the consolidator did not merge is kept.
  for (const finding of all) {
    if (used.has(finding.ref)) continue;
    const draft: DraftFinding = {
      source: 'raters',
      dimensionId: finding.dimensionId,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      fix: finding.fix,
      returnTo: finding.returnTo,
      location: finding.location,
      reportedBy: [finding.raterId],
    };
    const twin = merged.find((m) => sameFinding(m, draft));
    if (twin) {
      twin.reportedBy = [...new Set([...twin.reportedBy, finding.raterId])].sort();
      if (SEVERITY_ORDER[draft.severity] > SEVERITY_ORDER[twin.severity]) twin.severity = draft.severity;
    } else {
      merged.push(draft);
    }
  }
  return merged;
}

function mergeStrengths(input: ConsolidationInput, reply: ConsolidatorReply | null): Strength[] {
  const canonical = new Map(input.rated.map((d) => [d.id.toLowerCase(), d.id]));
  const out: Strength[] = [];
  const push = (dimensionId: string, text: string, location: CellRef | null) => {
    if (out.some((s) => normalise(s.text) === normalise(text))) return;
    out.push({ dimensionId, text, location });
  };

  for (const item of reply?.strengths ?? []) {
    const parsed = strengthSchema.safeParse(item);
    const dimensionId = parsed.success ? canonical.get(parsed.data.dimension.trim().toLowerCase()) : undefined;
    if (!parsed.success || !dimensionId) continue;
    const cited = parsed.data.location ? validateCitations(input.wb, input.allowedSheets, [parsed.data.location]).valid[0] : undefined;
    if (cited) push(dimensionId, parsed.data.text, { sheet: cited.sheet, cell: cited.cell });
  }
  if (out.length === 0) {
    for (const outcome of input.outcomes.filter((o) => o.status === 'ok')) {
      for (const s of outcome.strengths) push(s.dimensionId, s.text, s.location);
    }
  }
  return out.slice(0, 8);
}
