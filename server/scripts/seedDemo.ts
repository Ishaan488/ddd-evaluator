/**
 * Fills a running server with three iterations of the Talentra schema, each a little
 * better than the last, so the dashboard has a trend to show.
 *
 *   npm run seed:demo -w server            (server on http://localhost:4000)
 *   npm run seed:demo -w server -- http://localhost:4000 "Project name"
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCells } from './patchCells.js';

const base = process.argv[2] ?? 'http://localhost:4000';
const project = process.argv[3] ?? 'Talentra schema';
const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../samples/talentra');
const original = await readFile(path.join(samples, 'Talentra-Feature-Discovery-Dashboard.xlsx'));
const scorecard = await readFile(path.join(samples, 'talentra-schema-d2.yaml'));

const blank = (from: number, count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`H${from + i}`, null]));
const versions: Array<{ label: string; workbook: Buffer }> = [
  { label: 'v1: 12 missing definitions, a 4-level node, a choice field with no list', workbook: await patchCells(original, 'Tree', { ...blank(20, 12), E10: 4, L6: 'unbounded' }) },
  { label: 'v2: depth fixed, 3 definitions still missing', workbook: await patchCells(original, 'Tree', blank(20, 3)) },
  { label: 'v3: as delivered', workbook: original },
];

for (const version of versions) {
  const form = new FormData();
  form.append('workbook', new Blob([new Uint8Array(version.workbook)]), 'Talentra-schema.xlsx');
  form.append('scorecard', new Blob([new Uint8Array(scorecard)]), 'talentra-schema-d2.yaml');
  form.append('projectName', project);
  const response = await fetch(`${base}/api/runs`, { method: 'POST', body: form });
  const body = (await response.json()) as { runId?: string; error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  console.log(`submitted ${version.label}`);
  // Wait for it to finish so the iterations are scored in order.
  for (;;) {
    const run = (await (await fetch(`${base}/api/runs/${body.runId}`)).json()) as { status: string; weightedScore: number | null; finalDecision: string | null; error: string | null };
    if (run.status === 'done') {
      console.log(`  → ${run.finalDecision} ${run.weightedScore}`);
      break;
    }
    if (run.status === 'failed') throw new Error(run.error ?? 'run failed');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
console.log(`done. open ${base}`);
