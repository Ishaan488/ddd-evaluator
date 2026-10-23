import YAML from 'yaml';
import { scorecardFileSchema, type ScorecardFile } from '@ddd/shared';
import { TEXT_CHECKS, validateTextCheck } from '../agent/checks/textChecks.js';
import { parseReadsEntry } from '../agent/sectionPlanner.js';
import { errorMessage } from '../util/errors.js';
import type { DocumentOutline, ImportResult, ImportedQuestion } from './importer.js';

/** Pages one question may read from a PDF when a model has a small prompt limit (the free Groq tier). */
export const MAX_PAGES_PER_QUESTION = 3;
/** Pages one question may read when no rater is limited that tightly (for example on Bedrock). */
export const MAX_PAGES_ROOMY = 10;

/** The share of questions given to a person above which the draft is probably wrong. */
const MANY_HUMAN = 0.6;

const RANGE = /^pages?\s+(\d+)\s*(?:-|–|to)\s*(\d+)$/i;
const SINGLE_PAGE = /^page\s+(\d+)$/i;

/** [2, 8, 9] → ["Page 2", "Page 8-9"]: only the pages given, never the gaps between them. */
function pageRanges(pages: number[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let end = i;
    while (end + 1 < pages.length && pages[end + 1] === pages[end]! + 1) end++;
    out.push(end === i ? `Page ${pages[i]}` : `Page ${pages[i]}-${pages[end]}`);
    i = end + 1;
  }
  return out;
}

/** The page numbers a `reads` list names, in order, or null when an entry is not a page or a page range. */
function pagesOf(reads: string[]): number[] | null {
  const pages: number[] = [];
  for (const entry of reads) {
    const range = RANGE.exec(entry.trim());
    const single = SINGLE_PAGE.exec(entry.trim());
    if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) pages.push(n);
    else if (single) pages.push(Number(single[1]));
    else return null;
  }
  return pages;
}

export interface Draft {
  file: ScorecardFile;
  uncertain: string[];
  adjustments: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()) : [];
}

/** Checks the model's reply and repairs what code can. Throws, with a readable reason, when it cannot be used. */
type Dimension = Record<string, any>;

interface Criterion {
  id: string;
  name: string;
  kind: 'judged' | 'counted';
  /** A count that code can make exactly, proposed by the model and approved by the person. */
  check?: { id: string; params: Record<string, unknown>; fix?: string };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The source's own ratio bands when it states them (5 at 98% or more, 4 at 90%, 3 at 75%, 2 at 50%, 1 above 0). */
const RATIO_BANDS = [
  { min: 0.98, score: 5 },
  { min: 0.9, score: 4 },
  { min: 0.75, score: 3 },
  { min: 0.5, score: 2 },
  { min: 0.0001, score: 1 },
];

/** Dimensions made by code from a counted criterion, so the later "code cannot count this" repair leaves them alone. */
const countedByCode = new WeakSet<object>();

function checkOf(criterion: Record<string, unknown>, adjustments: string[]): Criterion['check'] {
  const raw = criterion.check as { id?: unknown; params?: unknown; fix?: unknown } | undefined;
  if (!raw || typeof raw.id !== 'string') return undefined;
  try {
    if (!(raw.id in TEXT_CHECKS)) throw new Error(`"${raw.id}" is not a count the app can make`);
    const params = (raw.params ?? {}) as Record<string, unknown>;
    validateTextCheck(raw.id, params);
    return { id: raw.id, params, ...(typeof raw.fix === 'string' ? { fix: raw.fix } : {}) };
  } catch (error) {
    adjustments.push(`${String(criterion.id ?? criterion.name)}: the proposed count was dropped (${errorMessage(error)}), so a person supplies it.`);
    return undefined;
  }
}

function criteriaOf(dim: Dimension, adjustments: string[]): Criterion[] {
  if (!Array.isArray(dim.criteria)) return [];
  return dim.criteria.flatMap((c: Record<string, unknown>) => {
    if ((c.kind !== 'judged' && c.kind !== 'counted') || typeof c.name !== 'string') return [];
    const check = c.kind === 'counted' ? checkOf(c, adjustments) : undefined;
    return [{ id: String(c.id ?? ''), name: c.name, kind: c.kind, ...(check ? { check } : {}) } as Criterion];
  });
}

/** Tells the examiners exactly which criteria the question covers, so a question is never just a title. */
function withChecklist(dim: Dimension, criteria: Criterion[]): Dimension {
  const judged = criteria.filter((c) => c.kind === 'judged').map((c) => c.name);
  if (judged.length === 0) return dim;
  const measure = typeof dim.measure === 'string' && dim.measure.trim() !== '' ? `${dim.measure.trim()} ` : '';
  return { ...dim, measure: `${measure}Check each of: ${judged.join('; ')}.` };
}

const needsOf = (counted: Criterion[]) => `A person counts or marks: ${counted.map((c) => c.name).join('; ')}.`;

/**
 * Splits dimensions by what the model said about each criterion, so the arithmetic is code and not a guess. Each kind
 * becomes its own part, and the weight is shared by criteria count: judged criteria stay in the dimension (examiners),
 * a counted criterion with an approved-by-a-person count definition becomes a code dimension of its own, and the other
 * counted ones become "-counted" for a person.
 */
function splitByCriteria(dimensions: Dimension[], adjustments: string[]): Dimension[] {
  return dimensions.flatMap((dim): Dimension[] => {
    const criteria = criteriaOf(dim, adjustments);
    delete dim.criteria;
    if (criteria.length === 0) return [dim];
    const checks = withChecklist(dim, criteria);
    const judged = criteria.filter((c) => c.kind === 'judged').length;
    const coded = criteria.filter((c) => c.kind === 'counted' && c.check);
    const people = criteria.filter((c) => c.kind === 'counted' && !c.check);
    if (judged === criteria.length) return [{ ...checks, measured_by: 'raters' }];
    if (coded.length === 0 && judged === 0) {
      const { anchors: _anchors, reads: _reads, ...rest } = dim;
      return [{ ...rest, measured_by: 'human', needs: needsOf(people) }];
    }
    const share = (count: number) => round2((Number(dim.weight) * count) / criteria.length);
    const parts: Dimension[] = [];
    if (judged > 0) parts.push({ ...checks, measured_by: 'raters', weight: round2(Number(dim.weight) - share(coded.length) - share(people.length)) });
    if (people.length > 0) {
      const part: Dimension = { id: judged > 0 ? `${dim.id}-counted` : dim.id, name: `${dim.name} (numbers to check)`, weight: share(people.length), critical: dim.critical, measured_by: 'human', needs: needsOf(people), ...(dim.return_to ? { return_to: dim.return_to } : {}) };
      parts.push(part);
    }
    coded.forEach((c, index) => {
      const part: Dimension = {
        id: c.id || `${dim.id}-K${index + 1}`,
        name: c.name,
        weight: share(1),
        critical: dim.critical,
        measured_by: 'code',
        measure: c.name,
        check: { id: c.check!.id, params: c.check!.params, bands: RATIO_BANDS, ...(c.check!.fix ? { fix: c.check!.fix } : {}) },
        ...(dim.return_to ? { return_to: dim.return_to } : {}),
      };
      countedByCode.add(part);
      parts.push(part);
      adjustments.push(`${part.id}: counted by code (${c.check!.id}). Confirm the words or pattern it counts before approving; the 0-5 bands are the source's ratio bands.`);
    });
    if (judged > 0 || people.length > 0) {
      const sentence = [judged > 0 ? `${judged} judged` : '', coded.length > 0 ? `${coded.length} counted by code` : '', people.length > 0 ? `${people.length} counted by a person` : ''].filter(Boolean).join(', ');
      if (coded.length === 0) {
        adjustments.push(`${dim.id}: ${judged} judged and ${people.length} counted criteria, so it was split into ${dim.id} (examiners, ${parts[0]!.weight}) and ${dim.id}-counted (a person, ${parts[1]!.weight}).`);
      } else {
        adjustments.push(`${dim.id}: split by criteria (${sentence}); the weight is shared by how many criteria each kind has.`);
      }
    }
    return parts;
  });
}

/** A judged question with no anchors of its own gets the source's general anchor, when the source has one. */
function fillAnchors(dimensions: Dimension[], general: unknown, adjustments: string[]): void {
  const anchors = general as Record<string, unknown> | undefined;
  const usable = anchors && ['0', '1', '2', '3', '4', '5'].every((level) => typeof anchors[level] === 'string' && anchors[level] !== '');
  for (const dim of dimensions) {
    if (dim.measured_by !== 'raters' || dim.anchors || !usable) continue;
    dim.anchors = Object.fromEntries(['0', '1', '2', '3', '4', '5'].map((level) => [level, anchors![level]]));
    adjustments.push(`${dim.id}: it had no anchors of its own, so the source's general anchor was used.`);
  }
}

export function checkDraft(reply: unknown, sourceName: string, outline: DocumentOutline | null, maxPages = MAX_PAGES_PER_QUESTION): Draft {
  if (!reply || typeof reply !== 'object' || !('scorecard' in reply)) throw new Error('the reply has no "scorecard" object');
  const { scorecard: raw, uncertain, adjustments } = reply as { scorecard: Record<string, unknown>; uncertain?: unknown; adjustments?: unknown };
  const notes = { uncertain: strings(uncertain), adjustments: strings(adjustments) };
  const draft = JSON.parse(JSON.stringify(raw)) as Record<string, any>;

  // A draft is never frozen and never claims an approval.
  draft.frozen = false;
  draft.approval = `Draft imported from ${sourceName} by AI, pending human review and approval`;
  draft.id = String(draft.id ?? 'SC-IMPORTED').replace(/[^\w-]+/g, '-');
  const t = draft.thresholds as { accept?: number; refine?: number } | undefined;
  if (!t || typeof t.accept !== 'number' || typeof t.refine !== 'number' || t.refine >= t.accept) {
    draft.thresholds = { accept: 90, refine: 75 };
    notes.adjustments.push('The thresholds were missing or inconsistent, so the standard 90 (green) and 75 (amber) were used.');
  }

  const dimensions = splitByCriteria(Array.isArray(draft.dimensions) ? draft.dimensions : [], notes.adjustments);
  draft.dimensions = dimensions;
  fillAnchors(dimensions, (reply as { general_anchor?: unknown }).general_anchor, notes.adjustments);
  for (const dim of dimensions) {
    if (countedByCode.has(dim)) continue;
    if (dim.measured_by === 'code' || (dim.check && dim.measured_by !== 'raters' && dim.measured_by !== 'human')) {
      dim.measured_by = 'human';
      delete dim.check;
      dim.needs ??= dim.measure ?? 'A person supplies this score.';
      notes.adjustments.push(`${dim.id}: the app cannot count this itself from an imported scorecard, so it is marked for a person to supply.`);
    }
    if (dim.measured_by === 'human') {
      dim.needs ??= dim.measure ?? 'A person supplies this score.';
      delete dim.anchors;
      delete dim.reads;
    }
  }

  const available = new Set((outline?.names ?? []).map((n) => n.toLowerCase()));
  if (outline) {
    const pages = outline.pages;
    const valid = (entry: string) => {
      const range = RANGE.exec(entry.trim());
      if (range) return outline.kind === 'pdf' && Number(range[1]) >= 1 && Number(range[2]) <= pages && Number(range[1]) <= Number(range[2]);
      return available.has(parseReadsEntry(entry).name.toLowerCase());
    };
    for (const dim of dimensions) {
      if (!Array.isArray(dim.reads)) continue;
      const kept = (dim.reads as string[]).filter(valid);
      if (kept.length !== dim.reads.length) {
        notes.adjustments.push(`${dim.id}: dropped ${dim.reads.length - kept.length} page or sheet name(s) that the document does not have.`);
      }
      if (kept.length > 0) dim.reads = kept;
      else delete dim.reads;
    }
    if (outline.kind === 'pdf') {
      for (const dim of dimensions) {
        const pages = Array.isArray(dim.reads) ? pagesOf(dim.reads as string[]) : null;
        if (!pages || pages.length <= maxPages) continue;
        const kept = pages.slice(0, maxPages);
        dim.reads = pageRanges(kept);
        notes.adjustments.push(`${dim.id}: it named ${pages.length} pages, more than the models can read at once, so it was cut to ${(dim.reads as string[]).join(', ')}. Widen it by hand if the evidence is elsewhere.`);
      }
    }
    const sheets = outline.kind === 'pdf' ? [{ name: `Page 1-${pages}`, header_row: 1 }] : outline.names.map((name) => ({ name, header_row: 1 }));
    draft.artifact = { sheets, context_sheets: [] };
  } else {
    draft.artifact ??= { sheets: [{ name: 'Sheet1', header_row: 1 }], context_sheets: [] };
    notes.uncertain.push('No document was given, so the sheets and pages each question reads are not set. Edit artifact and reads before approving.');
  }

  const people = dimensions.filter((d) => d.measured_by === 'human').length;
  if (dimensions.length >= 3 && people / dimensions.length >= MANY_HUMAN) {
    notes.uncertain.unshift(
      `${people} of ${dimensions.length} questions are marked "need a person". Check that questions an examiner could judge by reading were not given to a person by mistake, and read the original again.`,
    );
  }

  const result = scorecardFileSchema.safeParse({ scorecard: draft });
  if (!result.success) {
    const lines = result.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`the scorecard does not match the format: ${lines.join('; ')}`);
  }
  return { file: result.data, ...notes };
}

export function summarise(file: ScorecardFile): ImportResult['summary'] {
  const dims = file.scorecard.dimensions;
  const byPerson = dims.filter((d) => d.measured_by === 'human' || d.measurable_by_agent === false).length;
  const byCode = dims.filter((d) => d.measured_by === 'code' || (d.check && d.measured_by === undefined)).length;
  return {
    dimensions: dims.length,
    byExaminers: dims.length - byPerson - byCode,
    byCode,
    byPerson,
    critical: dims.filter((d) => d.critical).length,
    weightTotal: Math.round(dims.reduce((sum, d) => sum + d.weight, 0) * 100) / 100,
  };
}

/** What a count does, in words a reviewer can check against the original. */
function describeCheck(check: { id: string; params: Record<string, unknown> }): string {
  const p = check.params as { terms?: string[]; find?: string; valid?: string };
  if (check.id === 'text_terms_absent') return `Counts the lines that avoid: ${(p.terms ?? []).join(', ')}`;
  if (check.id === 'text_terms_present') return `Looks for each of: ${(p.terms ?? []).join(', ')}`;
  if (check.id === 'text_ids_valid') return `Checks that every ID shaped like ${p.find} fits ${p.valid}`;
  return `Counted by code (${check.id})`;
}

export function listQuestions(file: ScorecardFile): ImportedQuestion[] {
  return file.scorecard.dimensions.map((d) => {
    const code = d.measured_by === 'code' || (d.check && d.measured_by === undefined);
    return {
      id: d.id,
      name: d.name,
      weight: d.weight,
      critical: d.critical,
      by: code ? 'code' : d.measured_by === 'human' || d.measurable_by_agent === false ? 'person' : 'examiners',
      reads: d.reads ?? [],
      ...(code && d.check ? { how: describeCheck(d.check) } : {}),
    };
  });
}

export const draftToYaml = (file: ScorecardFile, sourceName: string): string =>
  `# DRAFT imported from ${sourceName} by AI. Compare every line with the original before approving.\n${YAML.stringify(file, { lineWidth: 110 })}`;

