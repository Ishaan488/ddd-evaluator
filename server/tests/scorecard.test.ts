import { describe, expect, it } from 'vitest';
import { parseScorecard } from '../src/scorecard/parse.js';
import { CLEAN_SCORECARD_YAML } from './helpers.js';

describe('scorecard parsing', () => {
  it('reads the PDF example format, including the free-text judges line and numeric anchors', () => {
    const { scorecard } = parseScorecard(
      `
scorecard:
  id: SC-STEP01-D2
  version: 1.0
  judges: D1 schema · Step 01
  frozen: true
  thresholds: { accept: 90, refine: 75 }
  artifact: { sheets: [Tree] }
  dimensions:
    - id: C01
      name: Structure conformance
      weight: 15
      critical: true
      measure: matching fields / all fields
      anchors: { 5: ">=98%", 4: "90-97%", 3: "75-89%", 2: "50-74%", 1: "1-49%", 0: "0% or missing" }
    - id: C08
      name: Author understanding
      weight: 10
      critical: true
      measurable_by_agent: false
`,
      'pdf.yaml',
    );
    expect(scorecard.gate).toBe('D1');
    expect(scorecard.version).toBe('1');
    expect(scorecard.dimensions[0]).toMatchObject({ measuredBy: 'raters', critical: true });
    expect(scorecard.dimensions[0]!.anchors![5]).toBe('>=98%');
    expect(scorecard.dimensions[1]!.measuredBy).toBe('human');
    expect(scorecard.artifact.sheets[0]).toEqual({ name: 'Tree', headerRow: 1 });
  });

  it('gives the same hash for the same content and a different hash when a weight changes', () => {
    const a = parseScorecard(CLEAN_SCORECARD_YAML);
    const b = parseScorecard(CLEAN_SCORECARD_YAML);
    const c = parseScorecard(CLEAN_SCORECARD_YAML.replace('weight: 20', 'weight: 21'));
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });

  it('accepts JSON as well as YAML', () => {
    const parsed = parseScorecard(
      JSON.stringify({
        scorecard: {
          id: 'J', version: '2', judges: 'D3', frozen: true, artifact: { sheets: ['Out'] },
          dimensions: [{ id: 'H', name: 'h', weight: 1, measured_by: 'human' }],
        },
      }),
    );
    expect(parsed.scorecard.gate).toBe('D3');
  });

  it.each([
    ['a rater dimension without anchors', CLEAN_SCORECARD_YAML.replace(/^ +anchors:.*\n/m, ''), /needs `anchors`/],
    ['a code dimension without a check', CLEAN_SCORECARD_YAML.replace(/^ +check:\n(?: {8}.*\n)+/m, '      measured_by: code\n'), /needs a `check`/],
    ['duplicate dimension ids', CLEAN_SCORECARD_YAML.replace('id: J01', 'id: C01'), /duplicate dimension id C01/],
    ['thresholds in the wrong order', CLEAN_SCORECARD_YAML.replace('frozen: true', 'frozen: true\n  thresholds: { accept: 70, refine: 80 }'), /refine must be below/],
    ['a judges line that is not D1 or D3', CLEAN_SCORECARD_YAML.replace('judges: D1 schema', 'judges: D2 scorecard'), /D1 \(schema\) or D3/],
    ['an anchor level that is missing', CLEAN_SCORECARD_YAML.replace('3: ok, ', ''), /anchor for score 3 is missing/],
  ])('rejects %s with a readable message', (_name, yaml, message) => {
    expect(() => parseScorecard(yaml, 'bad.yaml')).toThrow(message);
  });

  it('says which file is broken when the YAML itself is invalid', () => {
    expect(() => parseScorecard('a: [unclosed', 'broken.yaml')).toThrow(/broken\.yaml is not valid YAML/);
  });
});

describe('the shipped sample scorecards', () => {
  it.each(['talentra-schema-d2.yaml', 'talentra-step04-d4.yaml'])('%s parses, is frozen and has weights that add up to 100', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const { scorecard } = parseScorecard(await readFile(new URL(`../../samples/talentra/${file}`, import.meta.url), 'utf8'), file);
    expect(scorecard.frozen).toBe(true);
    expect(scorecard.dimensions.reduce((sum, d) => sum + d.weight, 0)).toBe(100);
    expect(scorecard.dimensions.some((d) => d.measuredBy === 'human' && d.critical)).toBe(true);
    for (const d of scorecard.dimensions.filter((x) => x.measuredBy === 'raters')) expect(Object.keys(d.anchors!)).toHaveLength(6);
  });
});

describe('the documentation examples', () => {
  it('the minimal scorecard in docs/scorecard-reference.md parses exactly as the docs say', async () => {
    const { readFile } = await import('node:fs/promises');
    const doc = await readFile(new URL('../../docs/scorecard-reference.md', import.meta.url), 'utf8');
    const section = doc.slice(doc.indexOf('## A minimal example'));
    const yaml = /```yaml\n([\s\S]*?)```/.exec(section)![1]!;
    const { scorecard } = parseScorecard(yaml, 'docs example');
    expect(scorecard.dimensions.map((d) => [d.id, d.measuredBy, d.critical])).toEqual([
      ['C01', 'code', true],
      ['J01', 'raters', false],
      ['H01', 'human', true],
    ]);
    expect(scorecard.thresholds).toEqual({ accept: 90, refine: 75 });
    expect(scorecard.gate).toBe('D1');
    expect(scorecard.dimensions[0]!.check!.bands.map((b) => b.score)).toEqual([5, 4, 3, 1]);
  });
});
