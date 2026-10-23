import { z } from 'zod';
import type { CellRef } from '@ddd/shared';
import { columnLetters } from '../../excel/workbook.js';
import { UserError } from '../../util/errors.js';
import type { CheckContext, CheckDefinition, CheckResult } from './types.js';

/**
 * Checks that count in the text itself (every line of a PDF page, or every filled cell of a sheet), so they work on a PDF
 * as well as on a workbook. Which words or pattern to count comes from the approved scorecard, never from the code.
 */

const MAX_FAILURES = 25;
const MAX_PATTERN_CHARS = 200;

const sheetsSchema = z.array(z.string().min(1)).min(1).optional();
const termsSchema = z.array(z.string().trim().min(1)).min(1).max(100);

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A term matches as a whole word or phrase, ignoring case. */
const termPattern = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, 'iu');

function patternOf(source: string, label: string): RegExp {
  if (source.length > MAX_PATTERN_CHARS) throw new UserError(`The ${label} pattern is longer than ${MAX_PATTERN_CHARS} characters.`);
  try {
    return new RegExp(source, 'u');
  } catch {
    throw new UserError(`The ${label} pattern "${source}" is not a valid pattern.`);
  }
}

interface Line {
  where: CellRef;
  text: string;
}

/** The non-empty cells of the named sheets (all sheets when none are named), in reading order. */
function linesOf(ctx: CheckContext, sheets: string[] | undefined): Line[] {
  const names = (sheets ?? ctx.wb.sheetNames()).map((name) => {
    const real = ctx.wb.resolveSheet(name);
    if (!real) throw new UserError(`Sheet "${name}" was not found. Sheets in this file: ${ctx.wb.sheetNames().join(', ')}`);
    return real;
  });
  return names.flatMap((sheet) =>
    ctx.wb
      .cells(sheet)
      .map(([row, col, text]): Line => ({ where: { sheet, cell: `${columnLetters(col)}${row}` }, text: text.trim() }))
      .filter((line) => line.text !== ''),
  );
}

const done = (passed: number, total: number, failures: CellRef[], summary: string): CheckResult => ({
  passed,
  total,
  failures: failures.slice(0, MAX_FAILURES),
  summary,
});

const absentParams = z.object({ terms: termsSchema, sheets: sheetsSchema });
const presentParams = z.object({ terms: termsSchema, sheets: sheetsSchema });
const idParams = z.object({ find: z.string().min(1), valid: z.string().min(1), sheets: sheetsSchema });

const termsAbsent: CheckDefinition = {
  describe: 'Lines of text must not contain any of the listed words or phrases (for example vague terms).',
  run(ctx, raw) {
    const p = absentParams.parse(raw);
    const patterns = p.terms.map(termPattern);
    const lines = linesOf(ctx, p.sheets);
    if (lines.length === 0) throw new UserError('There is no text to count in.');
    const failures = lines.filter((line) => patterns.some((pattern) => pattern.test(line.text))).map((line) => line.where);
    const passed = lines.length - failures.length;
    return done(passed, lines.length, failures, `${passed} of ${lines.length} lines are free of: ${p.terms.join(', ')}`);
  },
};

const termsPresent: CheckDefinition = {
  describe: 'Every listed word or phrase must appear somewhere in the text (coverage of a required list).',
  run(ctx, raw) {
    const p = presentParams.parse(raw);
    const lines = linesOf(ctx, p.sheets);
    const missing = p.terms.filter((term) => {
      const pattern = termPattern(term);
      return !lines.some((line) => pattern.test(line.text));
    });
    const passed = p.terms.length - missing.length;
    const tail = missing.length > 0 ? `; missing: ${missing.join(', ')}` : '';
    return done(passed, p.terms.length, [], `${passed} of ${p.terms.length} required terms appear in the text${tail}`);
  },
};

const idsValid: CheckDefinition = {
  describe: 'Everything that looks like an identifier ("find") must fit the strict identifier pattern ("valid").',
  run(ctx, raw) {
    const p = idParams.parse(raw);
    const find = new RegExp(patternOf(p.find, 'find').source, 'gu');
    const valid = patternOf(`^(?:${p.valid})$`, 'valid');
    let total = 0;
    let passed = 0;
    const failures: CellRef[] = [];
    for (const line of linesOf(ctx, p.sheets)) {
      for (const match of line.text.matchAll(find)) {
        total += 1;
        if (valid.test(match[0])) passed += 1;
        else failures.push(line.where);
      }
    }
    if (total === 0) throw new UserError(`Nothing in the text looks like an identifier (pattern ${p.find}).`);
    return done(passed, total, failures, `${passed} of ${total} identifiers fit the pattern ${p.valid}`);
  },
};

export const TEXT_CHECKS: Record<string, CheckDefinition> = {
  text_terms_absent: termsAbsent,
  text_terms_present: termsPresent,
  text_ids_valid: idsValid,
};

/** Checks a check's parameters without running it, so an import can drop a spec that would fail later. Throws a readable error. */
export function validateTextCheck(id: string, params: unknown): void {
  if (id === 'text_terms_absent') absentParams.parse(params);
  else if (id === 'text_terms_present') presentParams.parse(params);
  else if (id === 'text_ids_valid') {
    const p = idParams.parse(params);
    patternOf(p.find, 'find');
    patternOf(p.valid, 'valid');
  } else throw new UserError(`"${id}" is not a text check.`);
}
