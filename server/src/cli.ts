import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import './env.js';
import { loadAppConfig, loadModelsConfig } from './config.js';
import { evaluate } from './agent/index.js';
import { createProviderFactory } from './llm/registry.js';
import { assembleReport } from './report/assemble.js';
import { renderMarkdown } from './report/markdown.js';
import { renderXlsx } from './report/xlsx.js';
import { parseScorecard } from './scorecard/parse.js';
import { UserError } from './util/errors.js';

/** npm runs workspace scripts from server/, so paths are resolved from where the command was typed. */
export const resolveFromUser = (file: string, env: NodeJS.ProcessEnv = process.env): string =>
  path.resolve(env.INIT_CWD ?? process.cwd(), file);

const USAGE = `Usage: npm run evaluate -- --workbook <file.xlsx> --scorecard <file.yaml> [options]

  --workbook   the schema or output workbook to evaluate
  --scorecard  the frozen scorecard (YAML or JSON)
  --sources    optional text file with the problem statement or docket
  --out        folder for report.xlsx, report.md and report.json (default ./data/cli/<run id>)
  --mock       use the scripted mock models instead of live APIs
  --models     path to a models config (default server/config/models.json)`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      workbook: { type: 'string' },
      scorecard: { type: 'string' },
      sources: { type: 'string' },
      out: { type: 'string' },
      mock: { type: 'boolean', default: false },
      models: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.workbook || !values.scorecard) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }

  const env = { ...process.env, ...(values.mock ? { MOCK_LLM: '1' } : {}) };
  const config = loadAppConfig(env);
  const models = values.models ? loadModelsConfig(resolveFromUser(values.models)) : config.models;
  const workbookPath = resolveFromUser(values.workbook);
  const scorecardPath = resolveFromUser(values.scorecard);
  const parsed = parseScorecard(await readFile(scorecardPath, 'utf8'), path.basename(scorecardPath));
  const sources = values.sources ? await readFile(resolveFromUser(values.sources), 'utf8') : '';

  const runId = randomUUID();
  const out = values.out ? resolveFromUser(values.out) : path.join(config.dataDir, 'cli', runId);
  console.log(`Evaluating ${path.basename(workbookPath)} against ${parsed.scorecard.id} (${config.mock || values.mock ? 'mock models' : 'live models'})`);

  const result = await evaluate({
    runId,
    projectName: path.basename(workbookPath, path.extname(workbookPath)),
    iteration: 1,
    workbookPath,
    artifactName: path.basename(workbookPath),
    scorecard: parsed.scorecard,
    scorecardHash: parsed.hash,
    sources,
    models,
    providers: createProviderFactory(models, { env, mockDelayMs: 0 }),
    env,
    onProgress: (event) => {
      if (event.type === 'stage') console.log(`  · ${event.stage}`);
      else if (event.status !== 'running' && event.status !== 'waiting') console.log(`    ${event.id}: ${event.status}${event.error ? ` (${event.error})` : ''}`);
    },
  });

  const report = assembleReport(result.core, [], null);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(out, 'report.md'), renderMarkdown(report));
  await writeFile(path.join(out, 'report.xlsx'), await renderXlsx(report));

  const { verdict } = report;
  console.log(`\nVerdict: ${verdict.decision.toUpperCase()}  score ${verdict.weightedScore}`);
  for (const reason of verdict.reasons) console.log(`  - ${reason}`);
  console.log(`Findings: ${report.findings.length}   Report written to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof UserError ? error.message : error);
    process.exit(1);
  });
}
