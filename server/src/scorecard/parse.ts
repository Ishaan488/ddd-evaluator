import YAML from 'yaml';
import { scorecardFileSchema, toScorecard, type Scorecard } from '@ddd/shared';
import { canonicalJson, sha256 } from '../util/hash.js';
import { UserError } from '../util/errors.js';

export interface ParsedScorecard {
  scorecard: Scorecard;
  /** Hash of the canonical parsed scorecard: what the report header shows. */
  hash: string;
}

export function parseScorecard(text: string, filename = 'scorecard'): ParsedScorecard {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    throw new UserError(`${filename} is not valid YAML or JSON: ${(error as Error).message}`);
  }

  const result = scorecardFileSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues
      .slice(0, 12)
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new UserError(`${filename} does not match the scorecard format:\n${lines.join('\n')}`);
  }

  const scorecard = toScorecard(result.data);
  return { scorecard, hash: sha256(canonicalJson(scorecard)) };
}
