import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { ConfigResponse } from '@ddd/shared';
import type { AppConfig } from '../config.js';
import type { Store } from '../db/store.js';
import { inspectRoster } from '../llm/roster.js';
import { PROMPT_VERSION } from '../agent/index.js';
import { renderMarkdown } from '../report/markdown.js';
import { renderXlsx } from '../report/xlsx.js';
import { UserError } from '../util/errors.js';
import type { EvaluationService } from './service.js';

export interface AppDeps {
  store: Store;
  service: EvaluationService;
  config: AppConfig;
  env: NodeJS.ProcessEnv;
  webDist?: string;
  log?: (message: string) => void;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const evidenceBody = z.object({
  dimensionId: z.string().min(1),
  score: z.number().int().min(0).max(5).nullable().optional(),
  note: z.string().trim().min(3, 'Say what the evidence is, in a few words.'),
  by: z.string().trim().min(1, 'Say who supplied it.'),
});

const overrideBody = z.object({
  decision: z.enum(['green', 'amber', 'red']),
  reason: z.string().trim().min(5, 'A written reason is required for an override.'),
  by: z.string().trim().min(1, 'Say who is overriding.'),
});

export function createApp(deps: AppDeps): express.Express {
  const { store, service, config } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: config.dbMode });
  });

  app.get('/api/config', (_req, res) => {
    const roster = inspectRoster(config.models, deps.env);
    const body: ConfigResponse = {
      mock: config.mock,
      raters: roster.raters,
      consolidator: roster.consolidator,
      problems: roster.problems,
      ready: roster.ready,
      promptVersion: PROMPT_VERSION,
      thresholds: { accept: 90, refine: 75 },
    };
    res.json(body);
  });

  app.get('/api/projects', async (_req, res) => {
    res.json(await store.listProjects());
  });

  app.get('/api/projects/:id', async (req, res) => {
    res.json(await store.getHistory(req.params.id));
  });

  app.post(
    '/api/runs',
    upload.fields([{ name: 'workbook', maxCount: 1 }, { name: 'scorecard', maxCount: 1 }]),
    async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const workbook = files?.workbook?.[0];
      const scorecard = files?.scorecard?.[0];
      if (!workbook) throw new UserError('Attach the workbook to evaluate (.xlsx).');
      if (!scorecard) throw new UserError('Attach the frozen scorecard (.yaml or .json).');
      if (!/\.xlsx$/i.test(workbook.originalname)) throw new UserError('The workbook must be an .xlsx file.');

      const body = req.body as Record<string, string | undefined>;
      const created = await service.submit({
        workbook: { name: workbook.originalname, buffer: workbook.buffer },
        scorecard: { name: scorecard.originalname, text: scorecard.buffer.toString('utf8') },
        sources: body.sources ?? '',
        projectName: body.projectName,
      });
      res.status(202).json(created);
    },
  );

  app.get('/api/runs/:id', async (req, res) => {
    res.json(await store.getRunDetail(req.params.id));
  });

  app.post('/api/runs/:id/evidence', async (req, res) => {
    const body = evidenceBody.parse(req.body);
    await store.addEvidence(req.params.id, { ...body, score: body.score ?? null });
    res.json(await store.getRunDetail(req.params.id));
  });

  app.post('/api/runs/:id/override', async (req, res) => {
    await store.addOverride(req.params.id, overrideBody.parse(req.body));
    res.json(await store.getRunDetail(req.params.id));
  });

  app.get('/api/runs/:id/report.:ext', async (req, res) => {
    const detail = await store.getRunDetail(req.params.id);
    if (!detail.report) throw new UserError('This run has no finished report yet.', 409);
    const base = `${detail.projectName}-iteration-${detail.iteration}`.replace(/[^\w.-]+/g, '_');
    switch (req.params.ext) {
      case 'xlsx':
        res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.attachment(`${base}.xlsx`).send(await renderXlsx(detail.report));
        return;
      case 'md':
        res.type('text/markdown').attachment(`${base}.md`).send(renderMarkdown(detail.report));
        return;
      case 'json':
        res.type('application/json').attachment(`${base}.json`).send(JSON.stringify(detail.report, null, 2));
        return;
      default:
        throw new UserError('Reports come as xlsx, md or json.', 404);
    }
  });

  app.use('/api', (_req, _res, next) => next(new UserError('No such endpoint.', 404)));

  if (deps.webDist && existsSync(deps.webDist)) {
    app.use(express.static(deps.webDist));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(deps.webDist!, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof UserError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues.map((i) => i.message).join(' ') });
    } else if (error instanceof multer.MulterError) {
      res.status(400).json({ error: `Upload problem: ${error.message}` });
    } else {
      deps.log?.(`unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      res.status(500).json({ error: 'Something went wrong on the server. See the server log.' });
    }
  };
  app.use(onError);
  return app;
}
