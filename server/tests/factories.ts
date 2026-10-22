import type { DimensionResult, DimensionSpec, HumanEvidence, Scorecard } from '@ddd/shared';

export interface DimInput {
  id: string;
  weight: number;
  score: number | null;
  critical?: boolean;
  measuredBy?: 'code' | 'raters' | 'human';
  status?: DimensionResult['status'];
}

/** A scorecard and matching dimension results, for testing the verdict rule in isolation. */
export function build(inputs: DimInput[], thresholds = { accept: 90, refine: 75 }) {
  const scorecard: Scorecard = {
    id: 'SC-T',
    name: 'Test',
    version: '1',
    gate: 'D1',
    frozen: true,
    thresholds,
    artifact: { sheets: [{ name: 'S', headerRow: 1 }], context: [] },
    dimensions: inputs.map((i): DimensionSpec => ({
      id: i.id,
      name: `Dim ${i.id}`,
      weight: i.weight,
      critical: i.critical ?? false,
      measuredBy: i.measuredBy ?? 'code',
      needs: i.measuredBy === 'human' ? 'An interview' : undefined,
    })),
  };
  const dimensions: DimensionResult[] = inputs.map((i) => ({
    id: i.id,
    name: `Dim ${i.id}`,
    weight: i.weight,
    critical: i.critical ?? false,
    measuredBy: i.measuredBy ?? 'code',
    status: i.status ?? (i.measuredBy === 'human' ? 'not_measurable' : i.score === null ? 'unscored' : 'scored'),
    raterScores: {},
    consolidated: i.score,
    spread: null,
    resolution: 'code',
    flagged: false,
    rationale: '',
    evidence: [],
  }));
  return { scorecard, dimensions };
}

export function evidence(dimensionId: string, score: number | null, at = '2026-10-22T10:00:00Z'): HumanEvidence {
  return { id: `e-${dimensionId}-${at}`, runId: 'r', dimensionId, score, note: 'interview done', by: 'Mentor', createdAt: at };
}
