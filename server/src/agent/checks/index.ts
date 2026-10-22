import type { Band, CellRef, DimensionResult, DimensionSpec, Scorecard } from '@ddd/shared';
import type { WorkbookModel } from '../../excel/workbook.js';
import { errorMessage } from '../../util/errors.js';
import { CHECKS } from './library.js';
import { headerRowsOf, type CheckResult } from './types.js';

export interface CodeOutcome {
  result: DimensionResult;
  failures: CellRef[];
}

/** Maps a pass ratio to a 0-5 score using the scorecard's bands (highest band first). */
export function scoreFromRatio(ratio: number, bands: Band[]): number {
  const ordered = [...bands].sort((a, b) => b.min - a.min);
  for (const band of ordered) {
    if (ratio + 1e-9 >= band.min) return band.score;
  }
  return 0;
}

export function ratioOf(check: Pick<CheckResult, 'passed' | 'total'>): number {
  return check.total === 0 ? 1 : check.passed / check.total;
}

function baseResult(dim: DimensionSpec): DimensionResult {
  return {
    id: dim.id,
    name: dim.name,
    weight: dim.weight,
    critical: dim.critical,
    measuredBy: 'code',
    status: 'scored',
    raterScores: {},
    consolidated: null,
    spread: null,
    resolution: 'code',
    flagged: false,
    rationale: '',
    evidence: [],
  };
}

/** Scores every dimension that the scorecard assigns to code. A failing check never aborts the run. */
export function runCodeChecks(scorecard: Scorecard, wb: WorkbookModel): CodeOutcome[] {
  const headerRows = headerRowsOf(scorecard);
  return scorecard.dimensions
    .filter((dim) => dim.measuredBy === 'code')
    .map((dim): CodeOutcome => {
      const result = baseResult(dim);
      const spec = dim.check!;
      const definition = CHECKS[spec.id];
      if (!definition) {
        return {
          failures: [],
          result: { ...result, status: 'unscored', flagged: true, error: `Unknown check "${spec.id}"`, rationale: `Unknown check "${spec.id}".` },
        };
      }
      try {
        const outcome = definition.run({ wb, headerRows }, spec.params);
        const score = scoreFromRatio(ratioOf(outcome), spec.bands);
        return {
          failures: outcome.failures,
          result: {
            ...result,
            consolidated: score,
            rationale: outcome.summary,
            evidence: outcome.failures.slice(0, 5),
            codeDetail: { passed: outcome.passed, total: outcome.total, summary: outcome.summary },
          },
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          failures: [],
          result: { ...result, status: 'unscored', flagged: true, error: message, rationale: `The check could not run: ${message}` },
        };
      }
    });
}

export { CHECKS } from './library.js';
