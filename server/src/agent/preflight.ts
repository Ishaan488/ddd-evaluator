import type { Scorecard } from '@ddd/shared';
import type { WorkbookModel } from '../excel/workbook.js';
import { buildRaterPrompt } from './prompt.js';
import { RATER_SYSTEM } from './prompts/rater.js';
import { estimateTokens } from './rater.js';

/** An evaluation needs at least this many raters able to take the prompt, or it is not worth running. */
export const MIN_RATERS = 2;

export interface RaterLimit {
  id: string;
  model: string;
  /** Prompt ceiling set in models.json; undefined means no known limit. */
  maxInputTokens?: number;
  /** Limits of the fallback models that may answer if this one cannot. */
  fallbackLimits?: Array<number | undefined>;
}

export interface PreflightResult {
  /** Estimated size of the prompt every rater receives. */
  tokens: number;
  ok: boolean;
  fits: Array<RaterLimit & { fits: boolean }>;
  /** Plain-words explanation when it is not ok. */
  problem?: string;
}

/**
 * Checks, before anything is sent, that enough raters can take the prompt. Raters without a known limit are
 * assumed to fit. A scorecard with no rater dimensions sends no prompt, so it always passes.
 */
export function preflight(input: {
  scorecard: Scorecard;
  wb: WorkbookModel;
  sources: string;
  instructions?: string;
  raters: RaterLimit[];
}): PreflightResult {
  const { rated, user } = buildRaterPrompt(input);
  if (rated.length === 0) return { tokens: 0, ok: true, fits: input.raters.map((r) => ({ ...r, fits: true })) };

  const tokens = estimateTokens(RATER_SYSTEM) + estimateTokens(user);
  const canTake = (limit: number | undefined) => limit === undefined || tokens <= limit;
  const fits = input.raters.map((r) => ({ ...r, fits: canTake(r.maxInputTokens) || (r.fallbackLimits ?? []).some(canTake) }));
  const count = fits.filter((r) => r.fits).length;
  if (count >= MIN_RATERS) return { tokens, ok: true, fits };

  const blocked = fits
    .filter((r) => !r.fits)
    .map((r) => `${r.id} (${r.model}, limit ${r.maxInputTokens!.toLocaleString('en-US')}${r.fallbackLimits?.length ? ', and its fallbacks too' : ''})`)
    .join(', ');
  return {
    tokens,
    ok: false,
    fits,
    problem:
      `This evaluation sends about ${tokens.toLocaleString('en-US')} tokens to each rater, but only ${count} of ${fits.length} raters can take that: ` +
      `${blocked} cannot. At least ${MIN_RATERS} are needed for the result to mean anything. ` +
      'To fix it: (1) add a "columns" list to the scorecard\'s sheets so the raters see less, (2) use a smaller scorecard, ' +
      '(3) give a rater a model or plan with a larger limit (then raise or remove its maxInputTokens in server/config/models.json).',
  };
}
