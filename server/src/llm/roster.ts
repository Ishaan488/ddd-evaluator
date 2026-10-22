import type { ModelRef, RosterProblem } from '@ddd/shared';
import type { ModelEntry, ModelsConfig } from '../config.js';
import { UserError } from '../util/errors.js';

export interface RosterMember extends ModelRef {
  keyPresent: boolean;
  approved: boolean;
  maxInputTokens?: number;
}

export interface RosterStatus {
  raters: RosterMember[];
  consolidator: RosterMember;
  problems: RosterProblem[];
  ready: boolean;
}

function isApproved(models: ModelsConfig, entry: ModelEntry): boolean {
  return models.approved.some(
    (rule) => rule === `${entry.provider}:${entry.model}` || rule === `${entry.provider}:*`,
  );
}

function member(models: ModelsConfig, entry: ModelEntry, env: NodeJS.ProcessEnv): RosterMember {
  const provider = models.providers[entry.provider];
  const keyPresent = provider?.type === 'mock' || Boolean(provider?.keyEnv && env[provider.keyEnv]);
  return { ...entry, keyPresent, approved: isApproved(models, entry) };
}

/**
 * Checks the roster against the PDF's guardrails (page 13): independent raters from
 * different model families, and only approved models receive project documents.
 */
export function inspectRoster(models: ModelsConfig, env: NodeJS.ProcessEnv = process.env): RosterStatus {
  const raters = models.raters.map((entry) => member(models, entry, env));
  const consolidator = member(models, models.consolidator, env);
  const problems: RosterProblem[] = [];
  const error = (message: string) => problems.push({ level: 'error', message });

  const families = raters.map((r) => r.family);
  if (new Set(families).size !== families.length) {
    error('The three raters must come from three different model families.');
  }
  if (new Set(raters.map((r) => r.id)).size !== raters.length) error('Rater ids must be unique.');

  for (const m of [...raters, consolidator]) {
    const spec = models.providers[m.provider];
    const label = `${m.id} (${m.provider}:${m.model})`;
    if (!spec) error(`Model ${label} uses a provider that is not configured.`);
    else if (!m.keyPresent) error(`Model ${label} has no API key. Set ${spec.keyEnv} in .env.`);
    if (!m.approved) error(`Model ${label} is not on the approved list, so it may not receive project documents.`);
  }

  if (raters.some((r) => r.family === consolidator.family)) {
    problems.push({
      level: 'warning',
      message: 'The consolidator shares a model family with a rater. A fourth family is preferred.',
    });
  }
  return { raters, consolidator, problems, ready: !problems.some((p) => p.level === 'error') };
}

export function assertRosterReady(status: RosterStatus): void {
  if (status.ready) return;
  const lines = status.problems.filter((p) => p.level === 'error').map((p) => `  • ${p.message}`);
  throw new UserError(`The evaluator roster is not ready:\n${lines.join('\n')}`, 409);
}
