import type { Finding, Gate, ReturnTo, Scorecard } from '@ddd/shared';
import { SEVERITY_ORDER } from '@ddd/shared';
import type { CodeOutcome } from './checks/index.js';
import type { DraftFinding } from './types.js';

export function defaultReturnTo(gate: Gate): ReturnTo {
  return gate === 'D1' ? 'Define' : 'Generate';
}

/** One finding for every code check that did not come out perfect, pointing at the failing cells. */
export function findingsFromChecks(scorecard: Scorecard, outcomes: CodeOutcome[]): DraftFinding[] {
  const drafts: DraftFinding[] = [];
  for (const { result, failures } of outcomes) {
    const spec = scorecard.dimensions.find((d) => d.id === result.id)!;
    const score = result.consolidated;

    if (result.status === 'unscored') {
      drafts.push({
        source: 'code',
        dimensionId: spec.id,
        severity: 'HIGH',
        title: `${spec.name}: the check could not run`,
        detail: result.error ?? 'The check failed to run.',
        fix: 'Correct the scorecard or the workbook so the check can run, then resubmit.',
        returnTo: spec.returnTo ?? defaultReturnTo(scorecard.gate),
        location: null,
        reportedBy: ['code'],
      });
      continue;
    }
    if (score === null || score >= 5) continue;

    const severity = (spec.critical && score < 4) || score <= 2 ? 'HIGH' : score === 3 || spec.critical ? 'MEDIUM' : 'LOW';
    const cells = failures.slice(0, 5).map((f) => `${f.sheet}!${f.cell}`);
    const more = failures.length > 5 ? ` and ${failures.length - 5} more` : '';
    drafts.push({
      source: 'code',
      dimensionId: spec.id,
      severity,
      title: `${spec.name}: ${result.codeDetail?.summary ?? 'check not fully passed'}`,
      detail: cells.length > 0 ? `Failing cells: ${cells.join(', ')}${more}.` : (result.codeDetail?.summary ?? ''),
      fix: spec.check?.fix ?? 'Fix the flagged cells and resubmit.',
      returnTo: spec.returnTo ?? defaultReturnTo(scorecard.gate),
      location: failures[0] ?? null,
      reportedBy: ['code'],
    });
  }
  return drafts;
}

/** Gives every finding its id (F-01...), most severe first, then by scorecard order. */
export function finalizeFindings(scorecard: Scorecard, drafts: DraftFinding[]): Finding[] {
  const position = new Map(scorecard.dimensions.map((d, i) => [d.id, i]));
  const sorted = [...drafts].sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      (position.get(a.dimensionId) ?? 0) - (position.get(b.dimensionId) ?? 0) ||
      `${a.location?.sheet}${a.location?.cell}`.localeCompare(`${b.location?.sheet}${b.location?.cell}`),
  );
  const width = Math.max(2, String(sorted.length).length);
  return sorted.map((draft, index) => ({ ...draft, id: `F-${String(index + 1).padStart(width, '0')}` }));
}
