/**
 * Shows how many tokens each rater would be sent, before and after sectioning. It makes no API calls.
 *
 *   npm run prompt:size -- <workbook.xlsx> <scorecard.yaml>
 *
 * "Whole workbook" ignores any `reads` lists, which is what every rater was sent before sectioning existed.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadAppConfig } from '../src/config.js';
import { WorkbookModel } from '../src/excel/workbook.js';
import { serializeSheet } from '../src/excel/serialize.js';
import { buildAllRaterPrompts } from '../src/agent/prompt.js';
import { RATER_SYSTEM } from '../src/agent/prompts/rater.js';
import { estimateTokens } from '../src/agent/rater.js';
import { parseScorecardFile } from '../src/scorecard/parse.js';

const [workbookArg, scorecardArg] = process.argv.slice(2);
if (!workbookArg || !scorecardArg) {
  console.error('Usage: npm run prompt:size -- <workbook.xlsx> <scorecard.yaml|xlsx|json>');
  process.exit(1);
}
const resolve = (f: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), f);
const n = (v: number) => v.toLocaleString('en-US').padStart(7);

const wb = await WorkbookModel.load(await readFile(resolve(workbookArg)));
const { scorecard } = await parseScorecardFile(await readFile(resolve(scorecardArg)), path.basename(scorecardArg));
const system = estimateTokens(RATER_SYSTEM);

console.log(`\n${scorecard.id}: tokens per sheet (estimate, chars / 2.7)`);
for (const sheet of [...scorecard.artifact.sheets, ...scorecard.artifact.context]) {
  console.log(`  ${n(estimateTokens(serializeSheet(wb, sheet)))}  ${sheet.name}`);
}

const whole = { ...scorecard, dimensions: scorecard.dimensions.map(({ reads: _reads, ...d }) => d) };
const before = buildAllRaterPrompts({ scorecard: whole, wb, sources: '' }).map((p) => system + estimateTokens(p.prompt.user));
const after = buildAllRaterPrompts({ scorecard, wb, sources: '' });

console.log('\nEach rater is sent:');
console.log(`  ${n(Math.max(...before))}  whole workbook, one prompt (before sectioning)`);
for (const { label, prompt } of after) {
  console.log(`  ${n(system + estimateTokens(prompt.user))}  ${label}  (${prompt.rated.map((d) => d.id).join(', ')})`);
}
const total = after.reduce((sum, p) => sum + system + estimateTokens(p.prompt.user), 0);
console.log(`  ${n(total)}  all sections together (per rater)`);

const roster = loadAppConfig({ ...process.env, MOCK_LLM: '' }).models;
const sizes = after.map((p) => system + estimateTokens(p.prompt.user));
console.log('\nCan each model take it? (limits come from server/config/models.json)');
for (const r of roster.raters) {
  const limit = r.maxInputTokens;
  const ok = (size: number) => (limit === undefined || size <= limit ? 'fits' : 'too big');
  console.log(`  ${r.id} ${r.model} (limit ${limit ? n(limit).trim() : 'none'}):  whole workbook ${ok(Math.max(...before))}  |  ${sizes.map((s, i) => `section ${i + 1} ${ok(s)}`).join('  ')}`);
}
console.log('\nEstimates use chars / 2.7 and are only approximate; real counts show in a finished run under Technical details.');
