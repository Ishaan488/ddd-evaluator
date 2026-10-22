import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigResponse, ProjectHistory, ProjectSummary, RunDetail } from '@ddd/shared';
import { createApp } from '../src/api/app.js';
import { EvaluationService } from '../src/api/service.js';
import type { AppConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createDb, type Db } from '../src/db/pool.js';
import { Store } from '../src/db/store.js';
import { createProviderFactory } from '../src/llm/registry.js';
import { CLEAN_SCORECARD_YAML, CLEAN_TREE, TALENTRA_SCORECARD, TALENTRA_XLSX, makeWorkbook, mockModels, patchCells, tempDir } from './helpers.js';
import type { Server } from 'node:http';

interface Harness {
  base: string;
  store: Store;
  service: EvaluationService;
  db: Db;
  close(): Promise<void>;
}

/**
 * In-memory Postgres by default. Set TEST_DATABASE_URL to run the same tests against a
 * real Postgres; each harness then gets its own schema so they cannot disturb each other.
 */
async function testDb(): Promise<Db> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return createDb({ dbMode: 'memory', databaseUrl: undefined });
  const schema = `t_${Math.random().toString(36).slice(2, 10)}`;
  const admin = await createDb({ dbMode: 'postgres', databaseUrl: url });
  await admin.query(`create schema ${schema}`);
  await admin.close();
  return createDb({ dbMode: 'postgres', databaseUrl: `${url}${url.includes('?') ? '&' : '?'}options=-c%20search_path%3D${schema}` });
}

async function start(models = mockModels()): Promise<Harness> {
  const db = await testDb();
  await migrate(db);
  const store = new Store(db);
  const config: AppConfig = { port: 0, dataDir: await tempDir(), dbMode: process.env.TEST_DATABASE_URL ? 'postgres' : 'memory', databaseUrl: process.env.TEST_DATABASE_URL, mock: true, mockDelayMs: 0, models };
  const providers = createProviderFactory(models, { mockDelayMs: 0 });
  const service = new EvaluationService({ store, config, providers, env: {} });
  const server: Server = createApp({ store, service, config, env: {} }).listen(0);
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`, store, service, db,
    close: async () => { await service.idle(); await new Promise((r) => server.close(r)); await db.close(); },
  };
}

async function submit(h: Harness, files: { workbook?: Buffer; scorecard?: string; name?: string; scorecardName?: string; projectName?: string }) {
  const form = new FormData();
  if (files.workbook) form.append('workbook', new Blob([new Uint8Array(files.workbook)]), files.name ?? 'schema.xlsx');
  if (files.scorecard !== undefined) form.append('scorecard', new Blob([files.scorecard]), files.scorecardName ?? 'scorecard.yaml');
  if (files.projectName) form.append('projectName', files.projectName);
  const res = await fetch(`${h.base}/api/runs`, { method: 'POST', body: form });
  return { status: res.status, body: (await res.json()) as { runId?: string; iteration?: number; projectId?: string; error?: string } };
}

async function done(h: Harness, runId: string): Promise<RunDetail> {
  await h.service.idle();
  return (await (await fetch(`${h.base}/api/runs/${runId}`)).json()) as RunDetail;
}

const json = async <T>(res: Response) => (await res.json()) as T & { error?: string };
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let h: Harness;
let talentra: Buffer;
let scorecard: string;

beforeAll(async () => {
  h = await start();
  talentra = await readFile(TALENTRA_XLSX);
  scorecard = await readFile(TALENTRA_SCORECARD, 'utf8');
});
afterAll(() => h.close());

describe('API', () => {
  it('reports health and a ready roster, and never exposes a key', async () => {
    expect((await (await fetch(`${h.base}/api/health`)).json())).toMatchObject({ ok: true });
    const config = await json<ConfigResponse>(await fetch(`${h.base}/api/config`));
    expect(config.ready).toBe(true);
    expect(config.raters).toHaveLength(3);
    expect(config.consolidator.id).toBe('K');
    expect(JSON.stringify(config)).not.toMatch(/api[_-]?key"\s*:\s*"[^"]{8,}/i);
  });

  it('accepts a submission, runs it in the background and serves the finished report', async () => {
    const res = await submit(h, { workbook: talentra, scorecard, name: 'Talentra.xlsx', projectName: 'Talentra' });
    expect(res.status).toBe(202);
    expect(res.body.iteration).toBe(1);
    const run = await done(h, res.body.runId!);
    expect(run).toMatchObject({ status: 'done', stage: 'done', projectName: 'Talentra', iteration: 1, gate: 'D1', agentDecision: 'amber' });
    expect(run.report!.header.artifactName).toBe('Talentra.xlsx');
    expect(Object.keys(run.report!)).toEqual(expect.arrayContaining(['header', 'verdict', 'dimensions', 'strengths', 'findings', 'agreement', 'notMeasurable', 'pathToGreen']));
    expect(run.progress!.participants.map((p) => p.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(run.runLog!.participants).toHaveLength(4);
  });

  type Rejection = [string, { workbook?: Buffer | 'tree'; name?: string; scorecard?: string }, RegExp];
  const rejections: Rejection[] = [
    ['no workbook', { scorecard: CLEAN_SCORECARD_YAML }, /Attach the workbook/],
    ['no scorecard', { workbook: Buffer.from('x') }, /Attach the frozen scorecard/],
    ['a workbook that is not .xlsx', { workbook: Buffer.from('x'), name: 'notes.txt', scorecard: CLEAN_SCORECARD_YAML }, /must be an \.xlsx/],
    ['a file that is not a real workbook', { workbook: Buffer.from('not a zip'), scorecard: CLEAN_SCORECARD_YAML }, /not a valid \.xlsx/],
    ['an unfrozen scorecard', { workbook: 'tree', scorecard: CLEAN_SCORECARD_YAML.replace('frozen: true', 'frozen: false') }, /not frozen/],
    ['a scorecard in the wrong format', { workbook: 'tree', scorecard: 'scorecard: { id: x }' }, /does not match the scorecard format/],
    ['a scorecard naming a column that is missing', { workbook: 'tree', scorecard: CLEAN_SCORECARD_YAML.replace('sheets: [{ name: Tree, header_row: 1 }]', 'sheets: [{ name: Tree, header_row: 1, columns: [Nope] }]') }, /Column "Nope" named by the scorecard was not found in sheet "Tree"/],
    ['a scorecard naming a sheet that is missing', { workbook: 'tree', scorecard: CLEAN_SCORECARD_YAML.replace('name: Tree', 'name: Nope') }, /sheet "Nope" that this workbook does not have/],
  ];
  it.each(rejections)('rejects %s straight away with a clear message', async (_name, input, message) => {
    const workbook = input.workbook === 'tree' ? await makeWorkbook({ Tree: CLEAN_TREE }) : input.workbook;
    const res = await submit(h, { ...input, workbook });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(res.body.runId).toBeUndefined();
  });

  it('refuses to start when the roster is not ready, and says what to fix', async () => {
    const models = mockModels();
    models.approved = [];
    const closed = await start(models);
    const res = await submit(closed, { workbook: await makeWorkbook({ Tree: CLEAN_TREE }), scorecard: CLEAN_SCORECARD_YAML });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/roster is not ready.*not on the approved list/s);
    await closed.close();
  });

  it('shows a failed evaluation with its reason instead of hanging', async () => {
    const broken = await start(mockModels(['mock-down', 'mock-down', 'mock-down']));
    const res = await submit(broken, { workbook: await makeWorkbook({ Tree: CLEAN_TREE }), scorecard: CLEAN_SCORECARD_YAML });
    const run = await done(broken, res.body.runId!);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/All three raters failed/);
    expect(run.report).toBeNull();
    await broken.close();
  });

  it('records the person\'s evidence and override, recomputes the verdict, and keeps both visible', async () => {
    const res = await submit(h, { workbook: await makeWorkbook({ Tree: CLEAN_TREE }), scorecard: CLEAN_SCORECARD_YAML, projectName: 'Clean' });
    const before = await done(h, res.body.runId!);
    expect(before.report!.verdict.decision).toBe('amber');
    expect(before.report!.notMeasurable[0]!.evidence).toBeNull();

    const bad = await post(`${h.base}/api/runs/${res.body.runId}/evidence`, { dimensionId: 'C01', note: 'because', by: 'Mentor', score: 5 });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/not a human-only item/);
    const noNote = await post(`${h.base}/api/runs/${res.body.runId}/evidence`, { dimensionId: 'H01', note: '', by: 'Mentor' });
    expect((await json(noNote)).error).toMatch(/Say what the evidence is/);

    const ok = await json<RunDetail>(await post(`${h.base}/api/runs/${res.body.runId}/evidence`, { dimensionId: 'H01', note: 'Interview on 22 Oct', by: 'Mentor', score: 5 }));
    expect(ok.evidence).toHaveLength(1);
    expect(ok.report!.notMeasurable[0]!.evidence).toMatchObject({ score: 5, by: 'Mentor' });
    expect(ok.report!.verdict.criticalGates.find((g) => g.dimensionId === 'H01')!.status).toBe('passed');
    expect(ok.report!.verdict.decision).toBe('green');
    expect(ok.agentDecision).toBe('green');

    const noReason = await post(`${h.base}/api/runs/${res.body.runId}/override`, { decision: 'green', reason: '', by: 'Lead' });
    expect((await json(noReason)).error).toMatch(/written reason is required/);
    const overridden = await json<RunDetail>(await post(`${h.base}/api/runs/${res.body.runId}/override`, { decision: 'red', reason: 'Schema is being replaced', by: 'Lead' }));
    expect(overridden.report!.verdict).toMatchObject({ decision: 'red', override: { by: 'Lead', reason: 'Schema is being replaced' } });
    expect(overridden.agentDecision).toBe('green');
    expect(overridden.finalDecision).toBe('red');
    expect(overridden.report!.verdict.agentDecision).toBe('green');
  });

  it('downloads the report as a real eight-sheet workbook, readable Markdown and JSON', async () => {
    const list = await json<ProjectSummary[]>(await fetch(`${h.base}/api/projects`));
    const run = list.find((p) => p.name === 'Talentra')!.latest!;

    const xlsx = await fetch(`${h.base}/api/runs/${run.id}/report.xlsx`);
    expect(xlsx.headers.get('content-disposition')).toMatch(/Talentra-iteration-1\.xlsx/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await xlsx.arrayBuffer()) as ArrayBuffer);
    expect(book.worksheets.map((s) => s.name)).toEqual([
      '1 Header', '2 Verdict', '3 Dimension scores', '4 Strengths', '5 Gaps and findings', '6 Rater agreement', '7 Not measurable', '8 Path to green',
    ]);
    expect(book.getWorksheet('2 Verdict')!.getRow(2).getCell(2).value).toBe('AMBER');

    const md = await (await fetch(`${h.base}/api/runs/${run.id}/report.md`)).text();
    for (const heading of ['## 1. Header', '## 2. Verdict', '## 3. Dimension scores', '## 4. Strengths', '## 5. Gaps and findings', '## 6. Rater agreement', '## 7. Not measurable here', '## 8. Path to green']) {
      expect(md).toContain(heading);
    }
    expect(JSON.parse(await (await fetch(`${h.base}/api/runs/${run.id}/report.json`)).text()).verdict.decision).toBe('amber');
    expect((await fetch(`${h.base}/api/runs/${run.id}/report.pdf`)).status).toBe(404);
  });

  it('answers 404 for an unknown run, project or endpoint', async () => {
    expect((await fetch(`${h.base}/api/runs/nope`)).status).toBe(404);
    expect((await fetch(`${h.base}/api/projects/nope`)).status).toBe(404);
    expect((await fetch(`${h.base}/api/nope`)).status).toBe(404);
  });
});

describe('history across iterations', () => {
  it('numbers the iterations, tracks the score and shows what was fixed, what stayed and what is new', async () => {
    const project = 'Iterating';
    const blank = (from: number, count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`H${from + i}`, null]));

    const v1 = await submit(h, { workbook: await patchCells(talentra, 'Tree', { ...blank(20, 12), E10: 4 }), scorecard, projectName: project });
    const v2 = await submit(h, { workbook: await patchCells(talentra, 'Tree', blank(20, 3)), scorecard, projectName: project });
    const v3 = await submit(h, { workbook: talentra, scorecard, projectName: project });
    expect([v1.body.iteration, v2.body.iteration, v3.body.iteration]).toEqual([1, 2, 3]);
    expect(new Set([v1.body.projectId, v2.body.projectId, v3.body.projectId]).size).toBe(1);
    await h.service.idle();

    const history = await json<ProjectHistory>(await fetch(`${h.base}/api/projects/${v1.body.projectId}`));
    expect(history.runs.map((r) => r.iteration)).toEqual([1, 2, 3]);
    const scores = history.trend.map((t) => t.score!);
    expect(scores[0]!).toBeLessThan(scores[1]!);
    expect(scores[1]!).toBeLessThan(scores[2]!);
    expect(history.thresholds).toEqual({ accept: 90, refine: 75 });

    expect(history.dimensions.map((d) => d.dimensionId)).toEqual(['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C09', 'J01', 'J02', 'J03', 'J04', 'J05', 'J06', 'H01']);
    const c01 = history.dimensions.find((d) => d.dimensionId === 'C01')!;
    expect(c01.scores).toEqual([1, 5, 5]);
    const diffs = history.findingDiffs;
    expect(diffs[0]).toMatchObject({ fixed: 0, stillOpen: 0 });
    expect(diffs[1]!.fixed).toBeGreaterThan(0);
    expect(diffs[1]!.stillOpen).toBeGreaterThan(0);
    expect(diffs[2]!.fixed).toBeGreaterThan(0);

    const projects = await json<ProjectSummary[]>(await fetch(`${h.base}/api/projects`));
    expect(projects.find((p) => p.name === project)).toMatchObject({ runCount: 3, scores });
  });

  it('marks runs left unfinished by a crashed server as failed on the next start', async () => {
    const created = await h.store.createRun({
      projectName: 'Orphan', gate: 'D1', scorecard: (await import('../src/scorecard/parse.js')).parseScorecard(CLEAN_SCORECARD_YAML).scorecard,
      scorecardHash: 'h', sources: '', artifactName: 'a.xlsx', artifactHash: 'h', artifactPath: '/x', progress: { participants: [] },
    });
    await h.store.setStage(created.runId, 'rating');
    expect(await h.store.failInterrupted()).toBeGreaterThanOrEqual(1);
    expect((await h.store.getRunDetail(created.runId)).error).toMatch(/server stopped/);
  });
});
