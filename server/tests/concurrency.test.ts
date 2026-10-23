import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/util/concurrency.js';
import { parseScorecard } from '../src/scorecard/parse.js';
import { TALENTRA_XLSX, mockModels, runEvaluation } from './helpers.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithConcurrency', () => {
  it('never runs more than the limit at once and keeps the order of the items', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([5, 1, 4, 2, 3, 6], 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await sleep(n);
      active--;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30, 60]);
    expect(peak).toBe(3);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 4, async (n: number) => n)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 9, async (n) => n + 1)).toEqual([2, 3]);
  });
});

describe('scoring sections at the same time', () => {
  it('gives the same scores and findings as one at a time', async () => {
    const sectioned = parseScorecard(await readFile(new URL('../../samples/talentra/talentra-schema-d2-sectioned.yaml', import.meta.url), 'utf8'));
    const run = async (sectionConcurrency: number) => {
      const models = mockModels();
      models.settings.sectionConcurrency = sectionConcurrency;
      return runEvaluation({ workbook: TALENTRA_XLSX, scorecard: sectioned, models });
    };
    const [one, many] = [await run(1), await run(4)];
    const scores = (r: typeof one) => r.core.dimensions.map((d) => [d.id, d.raterScores, d.consolidated, d.status]);
    expect(scores(many)).toEqual(scores(one));
    expect(many.core.findings.map((f) => f.title).sort()).toEqual(one.core.findings.map((f) => f.title).sort());
  });
});
