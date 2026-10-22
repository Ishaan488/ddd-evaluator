import type { ModelRef } from '@ddd/shared';
import { usableFallbacks, type RosterMember } from '../llm/roster.js';

export interface Candidate {
  /** Who answers. A fallback keeps the participant's id and family, so the three raters stay three different families. */
  ref: ModelRef;
  maxInputTokens?: number;
}

export interface Failure {
  model: string;
  error: string;
}

/** The participant's own model first, then its usable fallbacks (approved to receive documents, with a key) in order. */
export function candidatesFor(member: RosterMember): Candidate[] {
  const { id, family } = member;
  return [
    { ref: { id, family, provider: member.provider, model: member.model }, maxInputTokens: member.maxInputTokens },
    ...usableFallbacks(member).map((f) => ({
      ref: { id, family, provider: f.provider, model: f.model },
      maxInputTokens: f.maxInputTokens,
    })),
  ];
}

/**
 * Tries each candidate until one succeeds. Whatever failed on the way is returned, so the report can say
 * "X was unavailable, so Y answered". If every candidate fails, the last result is returned with all the reasons.
 */
export async function runWithFallback<T>(
  candidates: Candidate[],
  attempt: (candidate: Candidate) => Promise<T>,
  inspect: (result: T) => { ok: boolean; error?: string },
): Promise<{ result: T; failures: Failure[] }> {
  const failures: Failure[] = [];
  let last!: T;
  for (const candidate of candidates) {
    last = await attempt(candidate);
    const outcome = inspect(last);
    if (outcome.ok) return { result: last, failures };
    failures.push({ model: candidate.ref.model, error: outcome.error ?? 'it failed' });
  }
  return { result: last, failures };
}

export const describeFailures = (failures: Failure[]): string =>
  failures.map((f) => `${f.model}: ${f.error}`).join(' | then ');
