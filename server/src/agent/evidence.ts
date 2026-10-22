import type { Evidence } from '@ddd/shared';
import { parseAddress, type WorkbookModel } from '../excel/workbook.js';
import { normalise } from '../util/text.js';

export interface CitationInput {
  sheet: string;
  cell: string;
  quote?: string | null;
}

export type CitationResult = { ok: true; evidence: Evidence } | { ok: false; reason: string };

/**
 * "Every score and finding cites a location in the artifact. Unsupported claims are
 * discarded." (PDF page 13). A citation is supported when the sheet is part of this
 * evaluation, the cell exists, and any quote really appears in that cell.
 */
export function validateCitation(
  wb: WorkbookModel,
  allowedSheets: ReadonlySet<string>,
  input: CitationInput,
): CitationResult {
  const sheet = wb.resolveSheet(input.sheet);
  if (!sheet) return { ok: false, reason: `sheet "${input.sheet}" does not exist` };
  if (!allowedSheets.has(sheet.toLowerCase())) {
    return { ok: false, reason: `sheet "${sheet}" is not part of this evaluation` };
  }

  const address = input.cell.replace(/\$/g, '').split(':')[0]!.trim();
  const parsed = parseAddress(address);
  if (!parsed) return { ok: false, reason: `"${input.cell}" is not a cell address` };
  const cell = `${parsed.letters}${parsed.row}`;
  if (!wb.inBounds(sheet, cell)) return { ok: false, reason: `${sheet}!${cell} is outside the sheet` };

  const quote = (input.quote ?? '').replace(/(…|\.\.\.)$/, '').trim();
  if (quote !== '') {
    const text = wb.cellText(sheet, cell) ?? '';
    if (!normalise(text).includes(normalise(quote))) {
      return { ok: false, reason: `the quote does not appear in ${sheet}!${cell}` };
    }
  }
  return { ok: true, evidence: { sheet, cell, ...(quote ? { quote } : {}) } };
}

export function validateCitations(
  wb: WorkbookModel,
  allowedSheets: ReadonlySet<string>,
  inputs: CitationInput[],
): { valid: Evidence[]; reasons: string[] } {
  const valid: Evidence[] = [];
  const reasons: string[] = [];
  for (const input of inputs) {
    const result = validateCitation(wb, allowedSheets, input);
    if (result.ok) valid.push(result.evidence);
    else reasons.push(result.reason);
  }
  return { valid, reasons };
}
