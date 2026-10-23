/**
 * Drafts a scorecard in this app's format from a scorecard in any layout, on the command line.
 *
 *   npm run scorecard:import -- <scorecard-file> [document.xlsx|pdf] [--out folder]
 *
 * Writes draft.yaml and notes.json (what it was unsure about, what code changed, sizes). The draft is never frozen.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import '../src/env.js';
import { loadAppConfig } from '../src/config.js';
import { createProviderFactory } from '../src/llm/registry.js';
import { importCandidates, importWithFallbacks } from '../src/scorecard/importer.js';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : undefined;
const [scorecardArg, documentArg] = args;
if (!scorecardArg) {
  console.error('Usage: npm run scorecard:import -- <scorecard-file> [document.xlsx|pdf] [--out folder]');
  process.exit(1);
}
const resolve = (f: string) => path.resolve(process.env.INIT_CWD ?? process.cwd(), f);
const load = async (file: string) => ({ name: path.basename(file), bytes: await readFile(resolve(file)) });

const config = loadAppConfig();
const candidates = importCandidates(config.models, createProviderFactory(config.models));
if (candidates.length === 0) throw new Error('No model is ready. Check the keys with "npm run models:check".');
console.log(`Reading ${scorecardArg} with ${candidates[0]!.model.provider}/${candidates[0]!.model.model} ...`);

const started = Date.now();
const result = await importWithFallbacks(
  { source: await load(scorecardArg), ...(documentArg ? { document: await load(documentArg) } : {}) },
  candidates,
);
const seconds = Math.round((Date.now() - started) / 1000);

const folder = resolve(out ?? path.join('data', 'import', path.basename(scorecardArg).replace(/\.[^.]+$/, '')));
await mkdir(folder, { recursive: true });
await writeFile(path.join(folder, 'draft.yaml'), result.yaml);
const { model, summary, uncertain, adjustments, inputTokens, outputTokens } = result;
await writeFile(path.join(folder, 'notes.json'), JSON.stringify({ model, summary, uncertain, adjustments, inputTokens, outputTokens, seconds }, null, 2));
console.log(`${summary.dimensions} questions (${summary.byExaminers} for the examiners, ${summary.byPerson} for a person, ${summary.critical} must-pass), weights add to ${summary.weightTotal}.`);
console.log(`${seconds}s, ${inputTokens ?? '?'} tokens in, ${outputTokens ?? '?'} out. Written to ${folder}`);
