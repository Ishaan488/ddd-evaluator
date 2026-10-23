import type { Report, RunDetail } from '@ddd/shared';

/** "Field-definition quality · GATE" → "Field-definition quality"; "Purpose (counted)" → "Purpose (numbers to check)". */
export const plainName = (name: string): string =>
  name
    .replace(/\s*·\s*GATE\s*$/i, '')
    .replace(/\s*\(counted\)\s*$/i, ' (numbers to check)')
    .trim();

/**
 * The page shows names, not codes. This rewrites a report for display only: names lose their tags, and sentences that say
 * "G09 (Privacy…)" or "H01 · Author understanding" say just the name. The saved report and the downloads keep the codes.
 */
export function simplifyReport(report: Report): Report {
  const forms = report.dimensions
    .flatMap((d) => [`${d.id} (${d.name})`, `${d.id} · ${d.name}`, `${d.id} ${d.name}`].map((from) => [from, plainName(d.name)] as const))
    .sort((a, b) => b[0].length - a[0].length);
  const say = (text: string) => forms.reduce((t, [from, to]) => t.split(from).join(to), text);
  const named = <T extends { name: string }>(item: T): T => ({ ...item, name: plainName(item.name) });

  return {
    ...report,
    dimensions: report.dimensions.map(named),
    agreement: report.agreement.map(named),
    notMeasurable: report.notMeasurable.map(named),
    verdict: {
      ...report.verdict,
      reasons: report.verdict.reasons.map(say),
      criticalGates: report.verdict.criticalGates.map(named),
    },
    pathToGreen: {
      ...report.pathToGreen,
      steps: report.pathToGreen.steps.map(named),
      needsPerson: report.pathToGreen.needsPerson.map(say),
      note: say(report.pathToGreen.note),
    },
  };
}

export const simplifyRun = (run: RunDetail): RunDetail => (run.report ? { ...run, report: simplifyReport(run.report) } : run);
