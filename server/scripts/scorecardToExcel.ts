/**
 * Converts a YAML or JSON scorecard into the Excel layout, so people can edit it in a spreadsheet.
 *
 *   npm run scorecard:xlsx -- samples/talentra/talentra-schema-d2.yaml            (writes next to the input)
 *   npm run scorecard:xlsx -- in.yaml out.xlsx
 *
 * The Excel file reads back to exactly the same scorecard and hash (there is a test for that).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scorecardToWorkbook } from '../src/scorecard/excel.js';
import { parseScorecard } from '../src/scorecard/parse.js';

const from = (file: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('Usage: npm run scorecard:xlsx -- <scorecard.yaml> [out.xlsx]');
  process.exit(1);
}
const source = from(input);
const target = output ? from(output) : source.replace(/\.(ya?ml|json)$/i, '') + '.xlsx';
const { scorecard, hash } = parseScorecard(await readFile(source, 'utf8'), path.basename(source));
await writeFile(target, await scorecardToWorkbook(scorecard));
console.log(`Wrote ${target}\nscorecard ${scorecard.id} v${scorecard.version}, ${scorecard.dimensions.length} dimensions, hash ${hash.slice(0, 12)}`);
