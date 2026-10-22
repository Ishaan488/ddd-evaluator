import type { DimensionSpec, Scorecard } from '@ddd/shared';
import { serializeSheets } from '../excel/serialize.js';
import type { WorkbookModel } from '../excel/workbook.js';
import { buildRaterUser } from './prompts/rater.js';

export interface RaterPrompt {
  /** The dimensions the raters (not code, not a person) score. */
  rated: DimensionSpec[];
  /** The judged sheets as text with cell addresses; the consolidator is sent the same text. */
  artifactText: string;
  /** What every rater receives. */
  user: string;
}

/**
 * The one place that builds what the raters are sent. The orchestrator uses it to run an evaluation and
 * the pre-submit check uses it to measure one, so the size that is checked is the size that is sent.
 */
export function buildRaterPrompt(input: {
  scorecard: Scorecard;
  wb: WorkbookModel;
  sources: string;
  instructions?: string;
}): RaterPrompt {
  const { scorecard, wb } = input;
  const rated = scorecard.dimensions.filter((d) => d.measuredBy === 'raters');
  const artifactText = serializeSheets(wb, scorecard.artifact.sheets);
  const user = buildRaterUser({
    scorecard,
    dimensions: rated,
    artifactText,
    contextText: serializeSheets(wb, scorecard.artifact.context),
    sources: input.sources,
    instructions: input.instructions,
  });
  return { rated, artifactText, user };
}
