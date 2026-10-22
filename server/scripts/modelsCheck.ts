/**
 * Checks the evaluator roster against the real providers.
 *
 *   npm run models:check                 lists each provider's models and marks the roster's as found or missing
 *   npm run models:check -- --ping       also sends one tiny prompt to every roster model
 */
import '../src/env.js';
import { parseArgs } from 'node:util';
import { loadAppConfig } from '../src/config.js';
import { listModelsRequest, parseModelList } from '../src/llm/catalog.js';
import { createProviderFactory } from '../src/llm/registry.js';
import { inspectRoster } from '../src/llm/roster.js';

const { values } = parseArgs({ options: { ping: { type: 'boolean', default: false } } });
const config = loadAppConfig({ ...process.env, MOCK_LLM: '' });
const models = config.models;
const roster = inspectRoster(models, process.env);
const members = [...roster.raters, roster.consolidator];
// Fallbacks answer as their participant, so they are checked like any other model.
const entries = members.flatMap((m) => [
  { label: m.id, provider: m.provider, model: m.model, family: m.family, keyPresent: m.keyPresent, approved: m.approved },
  ...m.fallbacks.map((f) => ({ label: `${m.id} fallback`, provider: f.provider, model: f.model, family: m.family, keyPresent: f.keyPresent, approved: f.approved })),
]);
let failed = false;

console.log('Roster');
for (const m of entries) {
  const issues = [!m.keyPresent && 'no API key', !m.approved && 'not on the approved list'].filter(Boolean);
  console.log(`  ${m.label.padEnd(13)} ${m.provider}/${m.model}  (${m.family})  ${issues.length ? `✗ ${issues.join(', ')}` : '✓ key set, approved'}`);
  if (issues.length) failed = true;
}
for (const p of roster.problems.filter((p) => p.level === 'error' && /families|unique/.test(p.message))) {
  console.log(`  ✗ ${p.message}`);
  failed = true;
}

const providersUsed = [...new Set(entries.map((m) => m.provider))];
for (const name of providersUsed) {
  const spec = models.providers[name];
  const key = spec?.keyEnv ? process.env[spec.keyEnv] : undefined;
  if (!spec || !key) continue;
  const request = listModelsRequest(spec, key);
  if (!request) continue;
  console.log(`\n${name}: models offered`);
  try {
    const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    const offered = parseModelList(spec.type as 'openai-compatible' | 'gemini', await response.json());
    for (const m of entries.filter((x) => x.provider === name)) {
      const found = offered.includes(m.model);
      console.log(`  ${found ? '✓' : '✗'} ${m.model}${found ? '' : '  <- not offered. Pick one below and edit server/config/models.json'}`);
      if (!found) failed = true;
    }
    console.log(`  all: ${offered.sort().join(', ')}`);
  } catch (error) {
    console.log(`  ✗ could not list models: ${(error as Error).message}`);
    failed = true;
  }
}

if (values.ping && roster.ready) {
  console.log('\nPing');
  const providers = createProviderFactory(models);
  for (const m of entries) {
    const started = Date.now();
    try {
      const reply = await providers(m.provider).complete({
        model: m.model,
        system: 'Reply with one JSON object and nothing else.',
        user: 'Return {"ok": true}.',
        temperature: 0,
        maxOutputTokens: 1024,
      });
      console.log(`  ✓ ${m.label} ${m.provider}/${m.model}  ${Date.now() - started} ms  ${reply.text.replace(/\s+/g, ' ').slice(0, 60)}`);
    } catch (error) {
      console.log(`  ✗ ${m.label} ${m.provider}/${m.model}  ${(error as Error).message}`);
      failed = true;
    }
  }
}

console.log(failed ? '\nNot ready. Fix the lines marked ✗.' : '\nRoster is ready.');
process.exit(failed ? 1 : 0);
