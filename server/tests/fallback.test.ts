import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { evaluate, preflight, type ProgressEvent } from '../src/agent/index.js';
import { createApp } from '../src/api/app.js';
import { EvaluationService } from '../src/api/service.js';
import { migrate } from '../src/db/migrate.js';
import { createDb } from '../src/db/pool.js';
import { Store } from '../src/db/store.js';
import { WorkbookModel } from '../src/excel/workbook.js';
import { createProviderFactory } from '../src/llm/registry.js';
import { inspectRoster } from '../src/llm/roster.js';
import { TALENTRA_XLSX, loadTalentraScorecard, mockModels, runEvaluation, tempDir } from './helpers.js';

const withFallbacks = (rater: 0 | 1 | 2, fallbacks: Array<{ provider: string; model: string; maxInputTokens?: number }>, models = mockModels()) => {
  models.raters[rater]!.fallbacks = fallbacks;
  return models;
};

describe('fallback models', () => {
  it('step in when a rater\'s model fails, answer as the same participant and family, and are named in the report', async () => {
    const models = withFallbacks(1, [{ provider: 'mock', model: 'mock-lenient' }], mockModels(['mock-mid', 'mock-down', 'mock-strict']));
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models });

    expect(run.core.header.raters.map((r) => [r.id, r.model, r.family])).toEqual([
      ['A', 'mock-mid', 'family-0'], ['B', 'mock-lenient', 'family-1'], ['C', 'mock-strict', 'family-2'],
    ]);
    expect(run.core.dimensions.find((d) => d.id === 'J01')!.raterScores).toEqual({ A: 4, B: 5, C: 3 });
    const note = run.core.notes.join('\n');
    expect(note).toMatch(/Rater B: mock-down: .*unavailable.*mock-lenient answered instead \(same model family\)/);
    expect(run.core.notes.join(' ')).not.toMatch(/failed and was left out/);
    expect(run.runLog.models.map((m) => m.model)).toEqual(['mock-mid', 'mock-lenient', 'mock-strict', 'mock-consolidator']);
  });

  it('are tried in order, and when every one fails the report gives every reason', async () => {
    const models = withFallbacks(1, [{ provider: 'mock', model: 'mock-garbage' }, { provider: 'mock', model: 'mock-down' }], mockModels(['mock-mid', 'mock-down', 'mock-strict']));
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models });
    const failed = run.calls.find((c) => c.model.id === 'B')!;
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/mock-down: .*\| then mock-garbage: .*\| then mock-down: /s);
    expect(run.core.dimensions.find((d) => d.id === 'J01')!.raterScores.B).toBeNull();
  });

  it('also protect the consolidator', async () => {
    const models = mockModels(['mock-mid', 'mock-lenient', 'mock-strict'], 'mock-consolidator-down');
    models.consolidator.fallbacks = [{ provider: 'mock', model: 'mock-consolidator' }];
    const run = await runEvaluation({ workbook: TALENTRA_XLSX, models });
    expect(run.core.consolidatorFailed).toBe(false);
    expect(run.core.header.consolidator.model).toBe('mock-consolidator');
    expect(run.core.notes.join(' ')).toMatch(/Consolidator: .*mock-consolidator answered instead/);
  });

  it('let the dashboard show which model is answering right now', async () => {
    const models = withFallbacks(1, [{ provider: 'mock', model: 'mock-lenient' }], mockModels(['mock-mid', 'mock-down', 'mock-strict']));
    const parsed = await loadTalentraScorecard();
    const events: ProgressEvent[] = [];
    await evaluate({
      runId: 'r', projectName: 'p', iteration: 1, workbookPath: TALENTRA_XLSX, artifactName: 'a.xlsx', scorecard: parsed.scorecard,
      scorecardHash: parsed.hash, sources: '', models, providers: createProviderFactory(models, { mockDelayMs: 0 }), env: {},
      onProgress: (e) => events.push(e),
    });
    const b = events.filter((e): e is Extract<ProgressEvent, { type: 'participant' }> => e.type === 'participant' && e.id === 'B');
    expect(b.map((e) => `${e.status}:${e.model}`)).toEqual(['running:mock-down', 'running:mock-lenient', 'ok:mock-lenient']);
  });

  it('count when checking that enough raters can take the prompt', async () => {
    const wb = await WorkbookModel.load(TALENTRA_XLSX);
    const { scorecard } = await loadTalentraScorecard();
    const limits = (fallbackLimits?: Array<number | undefined>) => [
      { id: 'A', model: 'a', maxInputTokens: 8000, fallbackLimits },
      { id: 'B', model: 'b', maxInputTokens: 7000, fallbackLimits },
      { id: 'C', model: 'c' },
    ];
    expect(preflight({ scorecard, wb, sources: '', raters: limits() }).ok).toBe(false);
    expect(preflight({ scorecard, wb, sources: '', raters: limits([undefined]) }).ok).toBe(true);
    expect(preflight({ scorecard, wb, sources: '', raters: limits([4000]) }).problem).toMatch(/and its fallbacks too/);
  });
});

describe('the roster rules for fallbacks', () => {
  it('refuse a fallback that is not approved to receive documents', async () => {
    const models = withFallbacks(1, [{ provider: 'mock', model: 'mock-lenient' }]);
    models.approved = ['mock:mock-mid', 'mock:mock-lenient-not', 'mock:mock-strict', 'mock:mock-consolidator'];
    models.raters[1]!.model = 'mock-lenient-not';
    const status = inspectRoster(models, {});
    expect(status.ready).toBe(false);
    expect(status.problems.map((p) => p.message).join('\n')).toMatch(/Fallback mock:mock-lenient for B is not on the approved list/);
  });

  it('skip a fallback with no API key, with a warning and not an error', async () => {
    const models = withFallbacks(1, [{ provider: 'groq', model: 'some-model' }]);
    models.providers.groq = { type: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY' };
    models.approved.push('groq:*');
    const status = inspectRoster(models, {});
    expect(status.ready).toBe(true);
    expect(status.problems).toContainEqual({ level: 'warning', message: 'Fallback groq:some-model for B has no API key and will be skipped.' });
  });

  it('are shown by the API without any key', async () => {
    const models = withFallbacks(1, [{ provider: 'mock', model: 'mock-lenient' }]);
    const db = await createDb({ dbMode: 'memory', databaseUrl: undefined });
    await migrate(db);
    const store = new Store(db);
    const config = { port: 0, dataDir: await tempDir(), dbMode: 'memory' as const, databaseUrl: undefined, mock: true, mockDelayMs: 0, models };
    const service = new EvaluationService({ store, config, providers: createProviderFactory(models, { mockDelayMs: 0 }), env: {} });
    const server = createApp({ store, service, config, env: {} }).listen(0);
    const { port } = server.address() as AddressInfo;
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/config`)).json()) as { raters: Array<{ fallbacks: Array<{ model: string; keyPresent: boolean; approved: boolean }> }> };
    expect(body.raters[1]!.fallbacks).toEqual([expect.objectContaining({ model: 'mock-lenient', keyPresent: true, approved: true })]);
    expect(body.raters[0]!.fallbacks).toEqual([]);
    await new Promise((r) => server.close(r));
    await db.close();
  });
});
