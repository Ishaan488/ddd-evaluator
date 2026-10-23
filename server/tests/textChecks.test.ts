import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import { WorkbookModel } from '../src/excel/workbook.js';
import { runCodeChecks } from '../src/agent/checks/index.js';
import { checkDraft } from '../src/scorecard/importer.js';
import { listQuestions, summarise } from '../src/scorecard/importDraft.js';
import { parseScorecard } from '../src/scorecard/parse.js';
import { decide, effectiveDimensions } from '../src/agent/verdict.js';

function makePdf(pages: string[][]): Promise<Buffer> {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  pages.forEach((lines, i) => {
    if (i > 0) doc.addPage();
    for (const line of lines) doc.text(line);
  });
  doc.end();
  return done;
}

const BANDS = '[{ min: 0.98, score: 5 }, { min: 0.9, score: 4 }, { min: 0.75, score: 3 }, { min: 0.5, score: 2 }, { min: 0.0001, score: 1 }]';
const card = (dimensions: string) => `
scorecard:
  id: SC-TEXT
  name: text
  version: "1"
  judges: D1 schema design
  step: "1"
  frozen: true
  thresholds: { accept: 90, refine: 75 }
  artifact:
    sheets: [{ name: "Page 1-2", header_row: 1 }]
  dimensions:
${dimensions}`;

const dim = (id: string, check: string) => `
    - id: ${id}
      name: ${id}
      weight: 10
      measured_by: code
      check:
        id: ${check}
        bands: ${BANDS}`;

const PAGES = [
  ['Field ROLE-001 must be defined', 'Reviewed as appropriate, etc.', 'Owner ROLE-002 signs off'],
  ['Grant date and approver recorded', 'Field ROLE-3 is vague, TBD', 'Expiry is set'],
];

async function run(dimensions: string) {
  const wb = await WorkbookModel.load(await makePdf(PAGES));
  return runCodeChecks(parseScorecard(card(dimensions)).scorecard, wb);
}

describe('counting in the text of a PDF', () => {
  it('counts the lines free of the listed words and cites the page and line of each miss', async () => {
    const [out] = await run(`${dim('V1', 'text_terms_absent')}
        params: { terms: ["etc", "TBD", "as appropriate"] }`);
    expect(out!.result.codeDetail).toMatchObject({ passed: 4, total: 6 });
    expect(out!.result.consolidated).toBe(2);
    expect(out!.failures).toEqual([{ sheet: 'Page 1', cell: 'A2' }, { sheet: 'Page 2', cell: 'A2' }]);
    expect(out!.result.rationale).toBe('4 of 6 lines are free of: etc, TBD, as appropriate');
  });

  it('matches whole words only, ignoring case', async () => {
    const [out] = await run(`${dim('V1', 'text_terms_absent')}
        params: { terms: ["tbd", "set", "gran"] }`);
    // "TBD" matches in any case and "set" as a word, but "gran" does not match inside "Grant"
    expect(out!.result.codeDetail).toMatchObject({ passed: 4, total: 6 });
  });

  it('checks that every required term appears and names what is missing', async () => {
    const [out] = await run(`${dim('P1', 'text_terms_present')}
        params: { terms: ["grant date", "approver", "expiry", "last review date", "reason"] }`);
    expect(out!.result.codeDetail).toMatchObject({ passed: 3, total: 5 });
    expect(out!.result.rationale).toMatch(/missing: last review date, reason/);
    expect(out!.result.consolidated).toBe(2);
  });

  it('checks that identifiers fit the strict pattern', async () => {
    const [out] = await run(`${dim('I1', 'text_ids_valid')}
        params: { find: "ROLE-[0-9]+", valid: "ROLE-[0-9]{3}" }`);
    expect(out!.result.codeDetail).toMatchObject({ passed: 2, total: 3 });
    expect(out!.failures).toEqual([{ sheet: 'Page 2', cell: 'A2' }]);
  });

  it('leaves the dimension unscored and flagged rather than scoring nothing as perfect', async () => {
    const [none] = await run(`${dim('I1', 'text_ids_valid')}
        params: { find: "ZZZ-[0-9]+", valid: "ZZZ-[0-9]{3}" }`);
    expect(none!.result).toMatchObject({ status: 'unscored', flagged: true });
    expect(none!.result.error).toMatch(/Nothing in the text looks like an identifier/);
    const [bad] = await run(`${dim('S1', 'text_terms_absent')}
        params: { terms: ["x"], sheets: ["Page 99"] }`);
    expect(bad!.result.status).toBe('unscored');
    expect(bad!.result.error).toMatch(/Sheet "Page 99" was not found/);
  });
});

describe('importing a counted criterion that code can count', () => {
  const ANCHORS = { '0': 'a', '1': 'b', '2': 'c', '3': 'd', '4': 'e', '5': 'f' };
  const reply = (criteria: unknown[], extra: Record<string, unknown> = {}) => ({
    scorecard: {
      id: 'SC-X', name: 'X', version: '1', judges: 'D1 schema design', thresholds: { accept: 90, refine: 75 },
      artifact: { sheets: [{ name: 'Whatever' }] },
      dimensions: [{ id: 'G04', name: 'Field quality', weight: 10, critical: true, measured_by: 'raters', measure: 'm', anchors: ANCHORS, criteria, ...extra }],
    },
    uncertain: [],
    adjustments: [],
  });
  const vague = { id: 'G04-C04', name: 'Vague-term free', kind: 'counted', check: { id: 'text_terms_absent', params: { terms: ['etc', 'TBD'] } } };

  it('turns it into its own code question with the source bands, and leaves the others to the examiners and a person', () => {
    const { file, adjustments } = checkDraft(
      reply([{ id: 'G04-C01', name: 'Clear', kind: 'judged' }, { id: 'G04-C02', name: 'Count by hand', kind: 'counted' }, vague, { id: 'G04-C03', name: 'Reasoned', kind: 'judged' }]),
      'x',
      null,
    );
    const dims = Object.fromEntries(file.scorecard.dimensions.map((d) => [d.id, d]));
    expect(Object.keys(dims)).toEqual(['G04', 'G04-counted', 'G04-C04']);
    expect([dims.G04!.weight, dims['G04-counted']!.weight, dims['G04-C04']!.weight]).toEqual([5, 2.5, 2.5]);
    expect(dims['G04-C04']).toMatchObject({ measured_by: 'code', critical: true });
    expect(dims['G04-C04']!.check!.bands[0]).toEqual({ min: 0.98, score: 5 });
    expect(dims['G04-C04']!.check!.params).toEqual({ terms: ['etc', 'TBD'] });
    expect(adjustments.join(' ')).toMatch(/G04-C04: counted by code \(text_terms_absent\)\. Confirm the words/);
    expect(summarise(file)).toMatchObject({ byExaminers: 1, byCode: 1, byPerson: 1 });
    expect(listQuestions(file).find((q) => q.id === 'G04-C04')).toMatchObject({ by: 'code', how: 'Counts the lines that avoid: etc, TBD' });
  });

  it('turns a dimension of only code-counted criteria into code questions that share its weight', () => {
    const { file } = checkDraft(reply([vague, { ...vague, id: 'G04-C05', name: 'Present', check: { id: 'text_terms_present', params: { terms: ['approver'] } } }]), 'x', null);
    expect(file.scorecard.dimensions.map((d) => [d.id, d.measured_by, d.weight])).toEqual([['G04-C04', 'code', 5], ['G04-C05', 'code', 5]]);
  });

  it('drops a proposed count the app cannot make or whose pattern is broken, and leaves it to a person', () => {
    const unknown = { id: 'C1', name: 'Odd', kind: 'counted', check: { id: 'run_a_script', params: {} } };
    const broken = { id: 'C2', name: 'Pattern', kind: 'counted', check: { id: 'text_ids_valid', params: { find: '(', valid: 'x' } } };
    const { file, adjustments } = checkDraft(reply([{ id: 'J', name: 'Judged', kind: 'judged' }, unknown, broken]), 'x', null);
    expect(file.scorecard.dimensions.map((d) => [d.id, d.measured_by])).toEqual([['G04', 'raters'], ['G04-counted', 'human']]);
    expect(adjustments.join(' ')).toMatch(/C1: the proposed count was dropped/);
    expect(adjustments.join(' ')).toMatch(/C2: the proposed count was dropped/);
  });

  it('counts toward the verdict like any code question', async () => {
    const { file } = checkDraft(reply([vague]), 'x', null);
    const scorecard = parseScorecard(JSON.stringify({ scorecard: { ...file.scorecard, frozen: true } })).scorecard;
    const wb = await WorkbookModel.load(await makePdf([['All fine here', 'Nothing vague']]));
    const outcomes = runCodeChecks(scorecard, wb);
    expect(outcomes[0]!.result).toMatchObject({ status: 'scored', consolidated: 5 });
    const verdict = decide(scorecard, effectiveDimensions(scorecard, outcomes.map((o) => o.result), []), []);
    expect(verdict.score).toBe(100);
  });
});
