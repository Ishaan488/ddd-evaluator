import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { approveDraft, checkDraft, importScorecard, importWithFallbacks, outlineDocument, readSourceText } from '../src/scorecard/importer.js';
import { parseScorecard } from '../src/scorecard/parse.js';
import { decide, effectiveDimensions } from '../src/agent/verdict.js';
import { LlmError, type LlmProvider } from '../src/llm/types.js';
import { MockProvider } from '../src/llm/mock.js';

const ANCHORS = { '0': 'a', '1': 'b', '2': 'c', '3': 'd', '4': 'e', '5': 'f' };
const reply = (extra: Record<string, unknown> = {}) => ({
  scorecard: {
    id: 'SC X!', name: 'X', version: 1, judges: 'D1 schema design', frozen: true, approval: 'Approved by someone',
    thresholds: { accept: 90, refine: 75 }, red_at_or_below: 2,
    artifact: { sheets: [{ name: 'Whatever' }] },
    dimensions: [
      { id: 'G01', name: 'Judged', weight: 60, critical: true, measured_by: 'raters', measure: 'm', anchors: ANCHORS, reads: ['Page 1-2', 'Page 90-99', 'Nope'] },
      { id: 'G02', name: 'Counted', weight: 40, measured_by: 'code', measure: 'Fields with a source out of 426' },
    ],
    ...extra,
  },
  uncertain: ['a guess'],
  adjustments: [],
});

async function makePdf(pages: string[]): Promise<Buffer> {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  pages.forEach((text, i) => { if (i > 0) doc.addPage(); doc.text(text); });
  doc.end();
  return done;
}

const fake = (replies: string[]): { provider: LlmProvider; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    provider: { name: 'fake', complete: async (r) => { calls.push(r.user); const text = replies.shift(); if (!text) throw new LlmError('no more'); return { text, inputTokens: 5, outputTokens: 5 }; } },
  };
};
const deps = (provider: LlmProvider) => ({ provider, model: { id: 'A', provider: 'fake', model: 'm' }, settings: { temperature: 0, maxOutputTokens: 100 } });

describe('importing a scorecard written in another layout', () => {
  it('turns the model reply into a draft that is never frozen and never claims an approval', async () => {
    const pdf = await makePdf(['Intro', 'More', 'Third']);
    const outline = await outlineDocument({ name: 'd.pdf', bytes: pdf });
    const { file, adjustments } = checkDraft(reply(), 'theirs.xlsx', outline);
    const sc = file.scorecard;
    expect(sc.frozen).toBe(false);
    expect(sc.approval).toMatch(/Draft imported from theirs\.xlsx by AI, pending human review/);
    expect(sc.id).toBe('SC-X-');
    expect(sc.artifact.sheets).toEqual([{ name: 'Page 1-3', header_row: 1 }]);
    const judged = sc.dimensions.find((d) => d.id === 'G01')!;
    expect(judged.reads).toEqual(['Page 1-2']);
    expect(adjustments.join(' ')).toMatch(/G01: dropped 2 page or sheet name/);
    const counted = sc.dimensions.find((d) => d.id === 'G02')!;
    expect(counted.measured_by).toBe('human');
    expect(counted.needs).toMatch(/426/);
    expect(adjustments.join(' ')).toMatch(/G02: the app cannot count this itself/);
  });

  it('warns when most questions were given to a person, which usually means the model misread the layout', () => {
    const human = (id: string) => ({ id, name: id, weight: 10, measured_by: 'human', needs: 'n' });
    const many = checkDraft(reply({ dimensions: [human('A'), human('B'), human('C'), { id: 'D', name: 'D', weight: 10, measured_by: 'raters', anchors: ANCHORS }] }), 'x', null);
    expect(many.uncertain[0]).toMatch(/3 of 4 questions are marked "need a person"/);
    const few = checkDraft(reply(), 'x', null);
    expect(few.uncertain.join(' ')).not.toMatch(/marked "need a person"/);
  });

  it('splits a dimension in code from its criteria, sharing the weight by how many criteria each kind has', () => {
    const crit = (kind: 'judged' | 'counted', n: number) => Array.from({ length: n }, (_, i) => ({ id: `${kind}${i}`, name: `${kind} ${i}`, kind }));
    const mixed = { id: 'G02', name: 'Traceability', weight: 10, critical: true, measured_by: 'human', measure: 'm', anchors: ANCHORS, reads: ['Page 1'], criteria: [...crit('judged', 1), ...crit('counted', 3)] };
    const onlyCounted = { id: 'G04', name: 'Quality', weight: 10, critical: true, measured_by: 'raters', measure: 'm', anchors: ANCHORS, reads: ['Page 1'], criteria: crit('counted', 4) };
    const onlyJudged = { id: 'G11', name: 'Change', weight: 6, measured_by: 'human', needs: 'x', anchors: ANCHORS, criteria: crit('judged', 4) };
    const plain = { id: 'G01', name: 'Plain', weight: 5, measured_by: 'raters', anchors: ANCHORS };
    const { file, adjustments } = checkDraft(reply({ dimensions: [plain, mixed, onlyCounted, onlyJudged] }), 'x', null);
    const dims = Object.fromEntries(file.scorecard.dimensions.map((d) => [d.id, d]));
    expect(Object.keys(dims)).toEqual(['G01', 'G02', 'G02-counted', 'G04', 'G11']);
    expect([dims.G02!.weight, dims['G02-counted']!.weight]).toEqual([2.5, 7.5]);
    expect(dims.G02!.measured_by).toBe('raters');
    expect(dims['G02-counted']).toMatchObject({ measured_by: 'human', critical: true });
    expect(dims['G02-counted']!.needs).toMatch(/counted 0; counted 1; counted 2/);
    expect(dims.G04).toMatchObject({ measured_by: 'human', weight: 10, critical: true });
    expect(dims.G04!.anchors).toBeUndefined();
    expect(dims.G11!.measured_by).toBe('raters');
    expect(dims.G02!.measure).toBe('m Check each of: judged 0.');
    expect(dims.G11!.measure).toMatch(/Check each of: judged 0; judged 1; judged 2; judged 3\./);
    expect(adjustments.join(' ')).toMatch(/G02: 1 judged and 3 counted criteria, so it was split/);
    const total = file.scorecard.dimensions.reduce((sum, d) => sum + d.weight, 0);
    expect(total).toBe(5 + 10 + 10 + 6);
    expect(JSON.stringify(file)).not.toMatch(/"criteria"/);
  });

  it('gives a judged question the source\'s general anchor when it has none', () => {
    const noAnchors = { id: 'G01', name: 'x', weight: 10, measured_by: 'raters', measure: 'm' };
    const withGeneral = { ...reply({ dimensions: [noAnchors] }), general_anchor: ANCHORS };
    const { file, adjustments } = checkDraft(withGeneral, 'x', null);
    expect(file.scorecard.dimensions[0]!.anchors).toBeDefined();
    expect(adjustments.join(' ')).toMatch(/G01: it had no anchors of its own/);
    expect(() => checkDraft(reply({ dimensions: [noAnchors] }), 'x', null)).toThrow(/needs `anchors`/);
  });

  it('cuts a question that reads too many PDF pages down to what a small model can take', async () => {
    const pdf = await makePdf(Array.from({ length: 30 }, (_, i) => `Page text ${i + 1}`));
    const outline = await outlineDocument({ name: 'd.pdf', bytes: pdf });
    const wide = { id: 'G05', name: 'w', weight: 10, measured_by: 'raters', measure: 'm', anchors: ANCHORS, reads: ['Page 10-25'] };
    const scattered = { id: 'G06', name: 's', weight: 10, measured_by: 'raters', measure: 'm', anchors: ANCHORS, reads: ['Page 2', 'Page 8-9', 'Page 20'] };
    const fine = { id: 'G07', name: 'f', weight: 10, measured_by: 'raters', measure: 'm', anchors: ANCHORS, reads: ['Page 3-5'] };
    const { file, adjustments } = checkDraft(reply({ dimensions: [wide, scattered, fine] }), 'x', outline);
    const reads = Object.fromEntries(file.scorecard.dimensions.map((d) => [d.id, d.reads]));
    expect(reads).toEqual({ G05: ['Page 10-12'], G06: ['Page 2', 'Page 8-9'], G07: ['Page 3-5'] });
    expect(adjustments.join(' ')).toMatch(/G05: it named 16 pages/);
    expect(adjustments.join(' ')).not.toMatch(/G07: it named/);
  });

  it('lets a roomier roster read more pages per question', async () => {
    const pdf = await makePdf(Array.from({ length: 30 }, (_, i) => `Page text ${i + 1}`));
    const outline = await outlineDocument({ name: 'd.pdf', bytes: pdf });
    const wide = { id: 'G05', name: 'w', weight: 10, measured_by: 'raters', measure: 'm', anchors: ANCHORS, reads: ['Page 10-25'] };
    const small = checkDraft(reply({ dimensions: [wide] }), 'x', outline, 3).file.scorecard.dimensions[0]!.reads;
    const roomy = checkDraft(reply({ dimensions: [wide] }), 'x', outline, 10).file.scorecard.dimensions[0]!.reads;
    expect(small).toEqual(['Page 10-12']);
    expect(roomy).toEqual(['Page 10-19']);
  });

  it('refuses a reply with no scorecard or the wrong shape, and asks the model once more with the reason', async () => {
    expect(() => checkDraft({}, 'x', null)).toThrow(/no "scorecard"/);
    const bad = JSON.stringify(reply({ dimensions: [{ id: 'G01', name: 'x', weight: 1, measured_by: 'raters' }] }));
    const { provider, calls } = fake(['not json at all', JSON.stringify(reply())]);
    const result = await importScorecard({ source: { name: 'a.yaml', bytes: Buffer.from('some scorecard text') } }, deps(provider));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/previous_reply_problem/);
    expect(result.draft.scorecard.frozen).toBe(false);
    const failing = fake([bad, bad]);
    await expect(importScorecard({ source: { name: 'a.yaml', bytes: Buffer.from('t') } }, deps(failing.provider))).rejects.toThrow(/could not turn this into a usable scorecard/);
  });

  it('shows the model the original text and the document outline, and reports weights and counts', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Scorecard');
    sheet.addRow(['ID', 'Criterion']);
    sheet.addRow(['G01', 'Purpose is clear']);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const pdf = await makePdf(['Opening page', 'Second page']);
    const { provider, calls } = fake([JSON.stringify(reply())]);
    const result = await importScorecard({ source: { name: 'theirs.xlsx', bytes }, document: { name: 'd.pdf', bytes: pdf } }, deps(provider));
    expect(calls[0]).toContain('Purpose is clear');
    expect(calls[0]).toContain('Page 1: Opening page');
    expect(result.sourceText).toContain('G01');
    expect(result.summary).toMatchObject({ dimensions: 2, byExaminers: 1, byPerson: 1, critical: 1, weightTotal: 100 });
    expect(result.yaml.startsWith('# DRAFT imported from theirs.xlsx')).toBe(true);
    expect(await readSourceText({ name: 'n.txt', bytes: Buffer.from('plain text') })).toBe('plain text');
  });

  it('the YAML it writes is a valid scorecard in the app\'s own format, but not frozen, so it cannot be run yet', async () => {
    const { provider } = fake([JSON.stringify(reply())]);
    const result = await importScorecard({ source: { name: 'a.yaml', bytes: Buffer.from('t') } }, deps(provider));
    const parsed = parseScorecard(result.yaml, 'draft.yaml');
    expect(parsed.scorecard.frozen).toBe(false);
    expect(parsed.scorecard.redAtOrBelow).toBe(2);
  });

  it('approving needs a name, freezes the scorecard and records who approved it and when', () => {
    const draft = YAML.stringify(checkDraft(reply(), 'x.xlsx', null).file);
    const edited = draft.replace('Judged', 'Judged (edited)');
    const unapproved = approveDraft(edited);
    expect(unapproved.frozen).toBe(false);
    const approved = approveDraft(edited, 'Mentor', new Date('2026-10-23T00:00:00Z'));
    expect(approved.frozen).toBe(true);
    expect(approved.yaml).toContain('Approved by Mentor on 2026-10-23');
    expect(approved.yaml).toContain('Judged (edited)');
    expect(() => approveDraft('scorecard: { id: x }', 'Mentor')).toThrow(/has problems/);
    expect(() => approveDraft('::: not yaml :::\n\t- [', 'Mentor')).toThrow();
  });

  it('tries the backup model when the first one is overloaded, but not when the file itself is the problem', async () => {
    const down = fake([]).provider;
    const working = fake([JSON.stringify(reply())]);
    const busy: LlmProvider = { name: 'busy', complete: async () => { throw new LlmError('HTTP 503: high demand', 503); } };
    const input = { source: { name: 'a.yaml', bytes: Buffer.from('t') } };
    const result = await importWithFallbacks(input, [deps(busy), deps(working.provider)]);
    expect(result.summary.dimensions).toBe(2);
    expect(working.calls).toHaveLength(1);
    await expect(importWithFallbacks(input, [deps(busy), deps(down)])).rejects.toThrow(/could not turn this into a usable scorecard/);
    const empty = { source: { name: 'a.txt', bytes: Buffer.from('  ') } };
    await expect(importWithFallbacks(empty, [deps(working.provider)])).rejects.toThrow(/no readable text/);
  });

  it('the mock model gives a fixed sample so the screen works offline', async () => {
    const result = await importScorecard({ source: { name: 'a.yaml', bytes: Buffer.from('t') } }, deps(new MockProvider(0)));
    expect(result.summary.dimensions).toBe(3);
    expect(result.uncertain.join(' ')).toMatch(/mock model/);
  });
});

describe('the red line for a critical gate', () => {
  const card = (extra: string) => parseScorecard(`
scorecard:
  id: SC-G
  version: "1"
  judges: D1 schema design
  frozen: true
  thresholds: { accept: 90, refine: 75 }
  ${extra}
  artifact: { sheets: [Tree] }
  dimensions:
    - { id: A, name: a, weight: 90, measured_by: raters, measure: m, anchors: { 0: a, 1: b, 2: c, 3: d, 4: e, 5: f } }
    - { id: B, name: b, weight: 10, critical: true, measured_by: raters, measure: m, anchors: { 0: a, 1: b, 2: c, 3: d, 4: e, 5: f } }
`).scorecard;
  const results = (b: number) => [
    { id: 'A', name: 'a', weight: 90, critical: false, measuredBy: 'raters', status: 'scored', raterScores: {}, consolidated: 5, spread: 0, resolution: 'agreement', flagged: false, rationale: '', evidence: [] },
    { id: 'B', name: 'b', weight: 10, critical: true, measuredBy: 'raters', status: 'scored', raterScores: {}, consolidated: b, spread: 0, resolution: 'agreement', flagged: false, rationale: '', evidence: [] },
  ] as never;

  it('turns a high total red when a critical gate is at or below the line, and stays amber without a line', () => {
    const withLine = card('red_at_or_below: 2');
    expect(decide(withLine, effectiveDimensions(withLine, results(2), [])).decision).toBe('red');
    expect(decide(withLine, effectiveDimensions(withLine, results(3), [])).decision).toBe('amber');
    expect(decide(withLine, effectiveDimensions(withLine, results(4), [])).decision).toBe('green');
    const without = card('');
    expect(decide(without, effectiveDimensions(without, results(2), [])).decision).toBe('amber');
  });
});
