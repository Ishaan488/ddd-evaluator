import type { CellRef, Scorecard } from '@ddd/shared';
import type { WorkbookModel } from '../../excel/workbook.js';

export interface CheckContext {
  wb: WorkbookModel;
  /** Header row by sheet name, taken from the scorecard's artifact and context sheets. */
  headerRows: Map<string, number>;
}

export interface CheckResult {
  passed: number;
  total: number;
  /** Cells that failed, capped so the report stays readable. */
  failures: CellRef[];
  summary: string;
}

export interface CheckDefinition {
  describe: string;
  run(ctx: CheckContext, params: unknown): CheckResult;
}

export function headerRowsOf(scorecard: Scorecard): Map<string, number> {
  const map = new Map<string, number>();
  for (const sheet of [...scorecard.artifact.sheets, ...scorecard.artifact.context]) {
    map.set(sheet.name.toLowerCase(), sheet.headerRow);
  }
  return map;
}
