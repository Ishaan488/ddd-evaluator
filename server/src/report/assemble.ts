import type {
  AgreementRow,
  DimensionResult,
  EvaluationCore,
  HumanEvidence,
  NotMeasurableItem,
  Override,
  Report,
  Resolution,
} from '@ddd/shared';
import { buildPathToGreen, buildVerdictSection } from '../agent/index.js';

const RESOLUTION_NOTE: Record<Resolution, string> = {
  agreement: 'The raters agree within one point.',
  claims_checked: 'The raters differed by more than one point; the consolidator checked each claim against the artifact.',
  lower_stands: 'The disagreement could not be resolved from the artifact, so the lower score stands. A person should review.',
  single_rater: 'Only one rater produced a supported score. A person should review.',
  code: 'Measured by code.',
  none: '',
};

function latestByDimension(evidence: HumanEvidence[]): Map<string, HumanEvidence> {
  const map = new Map<string, HumanEvidence>();
  for (const item of [...evidence].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    map.set(item.dimensionId, item);
  }
  return map;
}

/**
 * Builds the eight-section report (PDF page 11). The evaluation itself never changes;
 * the verdict, the not-measurable list and the path to green are recomputed from it
 * whenever a person adds evidence or an override.
 */
export function assembleReport(core: EvaluationCore, evidence: HumanEvidence[], override: Override | null): Report {
  const supplied = latestByDimension(evidence);
  const specs = new Map(core.scorecard.dimensions.map((d) => [d.id, d]));

  const dimensions: DimensionResult[] = core.dimensions.map((dim) => {
    const person = supplied.get(dim.id);
    if (!person || (dim.measuredBy !== 'human' && dim.status !== 'not_measurable')) return dim;
    return {
      ...dim,
      status: person.score !== null ? 'scored' : 'not_measurable',
      consolidated: person.score,
      rationale: `${person.by}: ${person.note}`,
      flagged: false,
    };
  });

  const agreement: AgreementRow[] = core.dimensions
    .filter((dim) => dim.measuredBy === 'raters')
    .map((dim) => ({
      dimensionId: dim.id,
      name: dim.name,
      scores: dim.raterScores,
      spread: dim.spread,
      resolution: dim.resolution,
      flagged: dim.flagged,
      note: dim.status === 'scored' ? RESOLUTION_NOTE[dim.resolution] : dim.rationale,
    }));

  const notMeasurable: NotMeasurableItem[] = core.dimensions
    .filter((dim) => dim.measuredBy === 'human' || dim.status === 'not_measurable')
    .map((dim) => ({
      dimensionId: dim.id,
      name: dim.name,
      critical: dim.critical,
      weight: dim.weight,
      reason:
        dim.measuredBy === 'human'
          ? 'Only a person can provide this evidence.'
          : 'The raters could not measure this from the artifact.',
      whatIsNeeded: specs.get(dim.id)?.needs ?? 'A person scores this dimension and records the evidence.',
      evidence: supplied.get(dim.id) ?? null,
    }));

  const verdict = buildVerdictSection(core.scorecard, core.dimensions, evidence, override, core.findings);
  return {
    header: core.header,
    verdict,
    dimensions,
    strengths: core.strengths,
    findings: core.findings,
    agreement,
    notMeasurable,
    pathToGreen: buildPathToGreen(core.scorecard, core.dimensions, evidence, core.findings),
    notes: core.notes,
  };
}
