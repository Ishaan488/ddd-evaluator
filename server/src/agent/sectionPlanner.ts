import type { DimensionSpec, SheetSpec, Scorecard } from '@ddd/shared';

/**
 * One group of dimensions that all need the same set of sheets.
 * The orchestrator sends one prompt per section (three raters run in parallel per section,
 * just as before), then merges results from all sections before consolidation.
 */
export interface EvalSection {
  /** A human-readable label for logging, e.g. "section 1/3 [Tree]". */
  label: string;
  /** The rater dimensions in this group. */
  dimensions: DimensionSpec[];
  /** Artifact sheets to serialise for this section (may be a subset of scorecard.artifact.sheets). */
  sheets: SheetSpec[];
  /** Context sheets to serialise for this section (may be a subset of scorecard.artifact.context). */
  context: SheetSpec[];
}

/**
 * One `reads` entry is a sheet name, optionally narrowed to some of its columns: `Tree[Path id|Name|Definition]`.
 * Columns are separated by `|` so the entry survives being written in a comma-separated Excel cell.
 */
export function parseReadsEntry(entry: string): { name: string; columns?: string[] } {
  const match = /^(.*?)\s*\[(.+)\]\s*$/.exec(entry.trim());
  if (!match) return { name: entry.trim() };
  const columns = match[2]!.split('|').map((c) => c.trim()).filter(Boolean);
  return { name: match[1]!.trim(), columns: columns.length > 0 ? columns : undefined };
}

/**
 * Groups rater dimensions into sections by their `reads` fingerprint.
 *
 * Rules:
 * 1. Dimensions with no `reads` field → one catch-all section with the full workbook
 *    (same as the current behaviour — 100 % backward compatible).
 * 2. Dimensions that declare `reads` are grouped by their sorted sheet-name key.
 *    Dimensions with identical reads share a section and a single prompt.
 * 3. Sections that include a `reads` sheet resolve only against the scorecard's
 *    artifact.sheets list first, then artifact.context.  Any name not found in
 *    either is silently ignored (the rater simply won't see it, and the section
 *    planner doesn't crash a whole run over a typo).
 * 4. The catch-all section (if any) is placed last so small sections run first
 *    and the largest one benefits from rate-limit headroom built up during the run.
 */
export function planSections(scorecard: Scorecard): EvalSection[] {
  const allSheets = scorecard.artifact.sheets;
  const allContext = scorecard.artifact.context ?? [];

  /** Lookup maps keyed by normalised sheet name. */
  const sheetByName = new Map(allSheets.map((s) => [s.name.toLowerCase(), s]));
  const contextByName = new Map(allContext.map((s) => [s.name.toLowerCase(), s]));

  const raterDims = scorecard.dimensions.filter((d) => d.measuredBy === 'raters');

  /** Separate dimensions that have explicit reads from those that don't. */
  const withReads = raterDims.filter((d) => d.reads && d.reads.length > 0);
  const withoutReads = raterDims.filter((d) => !d.reads || d.reads.length === 0);

  /** Group withReads by sorted key. */
  const groups = new Map<string, DimensionSpec[]>();
  for (const dim of withReads) {
    const key = [...dim.reads!].sort().join('\x00');
    const existing = groups.get(key);
    if (existing) {
      existing.push(dim);
    } else {
      groups.set(key, [dim]);
    }
  }

  const sections: EvalSection[] = [];
  let idx = 0;

  for (const [key, dims] of groups) {
    idx++;
    const entries = key.split('\x00');
    const sheets: SheetSpec[] = [];
    const context: SheetSpec[] = [];
    for (const entry of entries) {
      const { name, columns } = parseReadsEntry(entry);
      const sheet = sheetByName.get(name.toLowerCase());
      const ctx = !sheet ? contextByName.get(name.toLowerCase()) : undefined;
      const base = sheet ?? ctx;
      if (!base) continue; // unknown names are skipped, so a typo cannot crash a whole run
      const spec: SheetSpec = columns ? { ...base, columns } : base;
      (sheet ? sheets : context).push(spec);
    }
    const names = entries;
    sections.push({
      label: `section ${idx} [${names.join(', ')}]`,
      dimensions: dims,
      sheets: sheets.length > 0 ? sheets : allSheets,
      context: context.length > 0 ? context : [],
    });
  }

  /** Catch-all section for dimensions without reads (always last). */
  if (withoutReads.length > 0) {
    sections.push({
      label: `section ${idx + 1} [full workbook]`,
      dimensions: withoutReads,
      sheets: allSheets,
      context: allContext,
    });
  }

  return sections;
}

/**
 * The sheets the consolidator needs. It only checks claims where the raters differ by more than one point,
 * so it is sent just the sheets that those dimensions read, not the whole workbook.
 * Returns null when the scorecard is not sectioned, which means "send everything, as before".
 */
export function sheetsForDisagreements(
  sections: EvalSection[],
  disputed: ReadonlySet<string>,
): { sheets: SheetSpec[]; context: SheetSpec[] } | null {
  if (sections.length <= 1) return null;
  const sheets = new Map<string, SheetSpec>();
  const context = new Map<string, SheetSpec>();
  for (const section of sections) {
    if (!section.dimensions.some((d) => disputed.has(d.id))) continue;
    section.sheets.forEach((s) => sheets.set(s.name.toLowerCase(), s));
    section.context.forEach((s) => context.set(s.name.toLowerCase(), s));
  }
  return { sheets: [...sheets.values()], context: [...context.values()] };
}
