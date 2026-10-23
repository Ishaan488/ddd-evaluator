import type { Scorecard, SheetSpec } from '@ddd/shared';
import type { WorkbookModel } from './workbook.js';

const RANGE = /^pages?\s+(\d+)\s*(?:-|–|to)\s*(\d+)$/i;

/** "Page 5-12" → ["Page 5", ..., "Page 12"] (only pages the file has); anything else → null. */
export function expandPageRange(name: string, pages: string[]): string[] | null {
  const match = RANGE.exec(name.trim());
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  return pages.filter((page) => {
    const n = Number(/^Page (\d+)$/.exec(page)?.[1]);
    return n >= from && n <= to;
  });
}

/**
 * A PDF has one "sheet" per page, which is far too many to list one by one. A scorecard may name a range
 * instead ("Page 5-12") in its sheets, its context sheets and its dimensions' `reads`; this turns each range into
 * the pages themselves. A scorecard with no ranges comes back untouched, so Excel runs are unaffected.
 */
export function resolvePageRanges(scorecard: Scorecard, wb: WorkbookModel): Scorecard {
  const pages = wb.sheetNames();
  const expandSpecs = (specs: SheetSpec[]): SheetSpec[] =>
    specs.flatMap((spec) => {
      const expanded = expandPageRange(spec.name, pages);
      return expanded ? expanded.map((name) => ({ ...spec, name })) : [spec];
    });
  const expandReads = (reads: string[]): string[] =>
    reads.flatMap((entry) => expandPageRange(entry, pages) ?? [entry]);

  const sheets = expandSpecs(scorecard.artifact.sheets);
  const context = expandSpecs(scorecard.artifact.context);
  const changed =
    sheets.length !== scorecard.artifact.sheets.length ||
    context.length !== scorecard.artifact.context.length ||
    scorecard.dimensions.some((d) => d.reads?.some((r) => RANGE.test(r.trim())));
  if (!changed) return scorecard;
  return {
    ...scorecard,
    artifact: { sheets, context },
    dimensions: scorecard.dimensions.map((d) => (d.reads ? { ...d, reads: expandReads(d.reads) } : d)),
  };
}
