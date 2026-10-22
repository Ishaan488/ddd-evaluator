import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { serializeSheet } from '../src/excel/serialize.js';
import { WorkbookModel } from '../src/excel/workbook.js';
import { estimateTokens } from '../src/agent/rater.js';
import { parseScorecard } from '../src/scorecard/parse.js';
import { TALENTRA_XLSX, makeWorkbook, mockModels, runEvaluation } from './helpers.js';

describe('what the raters are sent', () => {
  it('sends only the listed columns, from the header row down', async () => {
    const wb = await WorkbookModel.load(
      await makeWorkbook({ T: [['A title row'], ['id', 'def', 'internal'], ['1', 'first', 'secret-1'], ['2', 'second', 'secret-2']] }),
    );
    const text = serializeSheet(wb, { name: 'T', headerRow: 2, columns: ['id', 'def'] });
    expect(text).toContain('## Sheet: T (4 rows, 2 columns)');
    expect(text).toContain('A2="id" B2="def"');
    expect(text).toContain('B4="second"');
    expect(text).not.toMatch(/secret|title row|C\d/);
  });

  it('names the missing column and the columns that do exist', async () => {
    const wb = await WorkbookModel.load(await makeWorkbook({ T: [['id', 'def']] }));
    expect(() => serializeSheet(wb, { name: 'T', headerRow: 1, columns: ['nope'] })).toThrow(/Column "nope".*Columns: id, def/);
  });

  it('keeps a scorecard\'s columns through parsing', () => {
    const { scorecard } = parseScorecard(
      'scorecard:\n  id: S\n  version: 1\n  judges: D1\n  frozen: true\n  artifact:\n    sheets:\n      - { name: T, header_row: 2, columns: [a, b] }\n      - U\n  dimensions:\n    - { id: H, name: h, weight: 1, measured_by: human }\n',
    );
    expect(scorecard.artifact.sheets).toEqual([{ name: 'T', headerRow: 2, columns: ['a', 'b'] }, { name: 'U', headerRow: 1 }]);
  });

  it('keeps the Talentra prompts small enough to leave room on a paid Groq tier (regression guard)', async () => {
    const schema = parseScorecard(await readFile(new URL('../../samples/talentra/talentra-schema-d2.yaml', import.meta.url), 'utf8'));
    const output = parseScorecard(await readFile(new URL('../../samples/talentra/talentra-step04-d4.yaml', import.meta.url), 'utf8'));
    const [d2, d4] = await Promise.all([runEvaluation({ workbook: TALENTRA_XLSX, scorecard: schema }), runEvaluation({ workbook: TALENTRA_XLSX, scorecard: output })]);
    const tokens = (run: typeof d2) => estimateTokens(run.calls[0]!.prompt);
    expect(tokens(d2)).toBeLessThan(14_500);
    expect(tokens(d4)).toBeLessThan(5_000);
  });

  it('fails a rater early, with advice, when its prompt cannot fit the limit set for it', async () => {
    const models = mockModels();
    models.raters[0]!.maxInputTokens = 1_000;
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models });
    const a = run.calls.find((c) => c.model.id === 'A')!;
    expect(a).toMatchObject({ status: 'failed', attempts: 0 });
    expect(a.error).toMatch(/over the 1000 limit set for mock-mid.*"columns"/);
    expect(run.core.notes.join(' ')).toMatch(/Rater A .* failed and was left out/);
    expect(run.core.dimensions.find((d) => d.id === 'J01')!.raterScores).toMatchObject({ A: null, B: 5, C: 3 });
  });
});
