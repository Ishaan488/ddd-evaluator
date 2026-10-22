import type { SheetSpec } from '@ddd/shared';
import { UserError } from '../util/errors.js';
import { truncate } from '../util/text.js';
import { columnLetters, type WorkbookModel } from './workbook.js';

const MAX_CELL_CHARS = 400;

/**
 * Turns a sheet into text a model can cite from. Every non-empty cell is written with
 * its address (`H5="..."`), so a rater can point at the exact cell it relied on.
 * With `columns`, only those columns (and only the rows from the header down) are sent.
 */
export function serializeSheet(wb: WorkbookModel, spec: SheetSpec | string): string {
  const { name, headerRow, columns } = typeof spec === 'string' ? { name: spec, headerRow: 1, columns: undefined } : spec;
  const real = wb.resolveSheet(name);
  if (!real) return `## Sheet: ${name}\n(sheet not found)\n`;
  const size = wb.dimensions(real)!;

  let keep: Set<number> | null = null;
  if (columns) {
    const table = wb.table(real, headerRow);
    const wanted = columns.map((title) => table.headers.find((h) => h.title === title));
    const missing = columns.filter((_, i) => !wanted[i]);
    if (missing.length > 0) {
      throw new UserError(
        `Column "${missing[0]}" named by the scorecard was not found in sheet "${real}". Columns: ${table.headers.map((h) => h.title).join(', ')}`,
      );
    }
    keep = new Set(wanted.map((h) => h!.column.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)));
  }

  const shown = keep ? `${keep.size} columns` : `columns A-${columnLetters(Math.max(size.cols, 1))}`;
  const lines = [`## Sheet: ${real} (${size.rows} rows, ${shown})`];

  let currentRow = -1;
  let parts: string[] = [];
  const flush = () => {
    if (parts.length > 0) lines.push(`r${currentRow}: ${parts.join(' ')}`);
    parts = [];
  };

  for (const [row, col, text] of wb.cells(real)) {
    if (keep && (row < headerRow || !keep.has(col))) continue;
    if (row !== currentRow) {
      flush();
      currentRow = row;
    }
    parts.push(`${columnLetters(col)}${row}=${JSON.stringify(truncate(text, MAX_CELL_CHARS))}`);
  }
  flush();
  return lines.join('\n');
}

export function serializeSheets(wb: WorkbookModel, sheets: Array<SheetSpec | string>): string {
  return sheets.map((sheet) => serializeSheet(wb, sheet)).join('\n\n');
}
