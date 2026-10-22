import { beforeAll, describe, expect, it } from 'vitest';
import { validateCitation } from '../src/agent/evidence.js';
import { WorkbookModel } from '../src/excel/workbook.js';
import { makeWorkbook } from './helpers.js';

let wb: WorkbookModel;
const allowed = new Set(['tree']);

beforeAll(async () => {
  wb = await WorkbookModel.load(await makeWorkbook({
    Tree: [['id', 'definition'], ['1', 'The product the features are discovered for.'], ['2', null]],
    Secret: [['x']],
  }));
});

describe('evidence checking', () => {
  it('accepts a real cell with a quote that really appears in it', () => {
    expect(validateCitation(wb, allowed, { sheet: 'tree', cell: 'b2', quote: 'the PRODUCT  the features' })).toEqual({
      ok: true, evidence: { sheet: 'Tree', cell: 'B2', quote: 'the PRODUCT  the features' },
    });
  });

  it('accepts a cell with no quote, and an empty cell (a missing value can be cited)', () => {
    expect(validateCitation(wb, allowed, { sheet: 'Tree', cell: 'A2' }).ok).toBe(true);
    expect(validateCitation(wb, allowed, { sheet: 'Tree', cell: 'B3', quote: '' }).ok).toBe(true);
  });

  it('rejects a quote that does not appear in the cell', () => {
    const result = validateCitation(wb, allowed, { sheet: 'Tree', cell: 'B2', quote: 'something invented' });
    expect(result).toEqual({ ok: false, reason: 'the quote does not appear in Tree!B2' });
  });

  it('rejects an invented sheet, a sheet outside this evaluation, an address that is not a cell and a cell off the sheet', () => {
    expect(validateCitation(wb, allowed, { sheet: 'Nope', cell: 'A1' })).toMatchObject({ ok: false, reason: expect.stringMatching(/does not exist/) });
    expect(validateCitation(wb, allowed, { sheet: 'Secret', cell: 'A1' })).toMatchObject({ ok: false, reason: expect.stringMatching(/not part of this evaluation/) });
    expect(validateCitation(wb, allowed, { sheet: 'Tree', cell: 'row 5' })).toMatchObject({ ok: false, reason: expect.stringMatching(/not a cell address/) });
    expect(validateCitation(wb, allowed, { sheet: 'Tree', cell: 'Z99' })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside the sheet/) });
  });

  it('tolerates $ signs, a range (first cell) and a trailing ellipsis in the quote', () => {
    expect(validateCitation(wb, allowed, { sheet: 'Tree', cell: '$B$2:C3', quote: 'The product the…' }).ok).toBe(true);
  });
});
