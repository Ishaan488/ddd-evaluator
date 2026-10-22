import type {
  CriticalGate,
  Decision,
  DimensionResult,
  Finding,
  HumanEvidence,
  Override,
  Scorecard,
  VerdictSection,
} from '@ddd/shared';
import { floor1 } from '../util/text.js';

/** A dimension as the verdict sees it, after any score a person supplied. */
export interface EffectiveDimension {
  id: string;
  name: string;
  weight: number;
  critical: boolean;
  /** In the weighted score? Human items without a score are not. */
  counted: boolean;
  /** The 0-5 score used; unscored counted dimensions are 0. */
  score: number | null;
  /** A person still has to supply evidence before this can be green. */
  pending: boolean;
  /** A person supplied a score that failed or passed the critical gate. */
  gate: CriticalGate['status'];
}

export const CRITICAL_MINIMUM = 4;

function latestEvidence(evidence: HumanEvidence[]): Map<string, HumanEvidence> {
  const latest = new Map<string, HumanEvidence>();
  for (const item of [...evidence].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    latest.set(item.dimensionId, item);
  }
  return latest;
}

export function effectiveDimensions(
  scorecard: Scorecard,
  dimensions: DimensionResult[],
  evidence: HumanEvidence[],
): EffectiveDimension[] {
  const supplied = latestEvidence(evidence);
  const byId = new Map(dimensions.map((d) => [d.id, d]));

  return scorecard.dimensions.map((spec): EffectiveDimension => {
    const result = byId.get(spec.id);
    const person = supplied.get(spec.id);
    const needsPerson = spec.measuredBy === 'human' || result?.status === 'not_measurable';
    const base = { id: spec.id, name: spec.name, weight: spec.weight, critical: spec.critical };

    if (needsPerson) {
      if (!person) return { ...base, counted: false, score: null, pending: true, gate: 'pending' };
      const scored = person.score !== null;
      return {
        ...base,
        counted: scored,
        score: person.score,
        pending: false,
        gate: !scored || person.score! >= CRITICAL_MINIMUM ? 'passed' : 'failed',
      };
    }

    // Code and rater dimensions: an unscored one counts as 0, so a missing score can never help.
    const score = result?.status === 'scored' ? (result.consolidated ?? 0) : 0;
    return { ...base, counted: true, score, pending: false, gate: score >= CRITICAL_MINIMUM ? 'passed' : 'failed' };
  });
}

export function weightedScore(dimensions: EffectiveDimension[]): number {
  const counted = dimensions.filter((d) => d.counted);
  const total = counted.reduce((sum, d) => sum + d.weight, 0);
  if (total === 0) return 0;
  return (counted.reduce((sum, d) => sum + d.weight * (d.score ?? 0), 0) * 100) / (total * 5);
}

export interface AgentVerdict {
  score: number;
  decision: Decision;
  criticalGates: CriticalGate[];
  reasons: string[];
}

/** HIGH-risk findings "block green" (PDF p.11): they must be fixed before resubmission. */
export const blockingFindings = (findings: Finding[]): Finding[] => findings.filter((f) => f.severity === 'HIGH');

/**
 * The decision rule from PDF pages 11-12, applied by code and never by a model:
 *   Green  score >= accept, every critical gate passed, all human-only evidence supplied,
 *          and no HIGH-risk finding open
 *   Amber  score between refine and accept, or any critical gate below 4, or a HIGH finding
 *   Red    score below refine
 */
export function decide(scorecard: Scorecard, dimensions: EffectiveDimension[], blocking: Finding[] = []): AgentVerdict {
  const score = weightedScore(dimensions);
  const { accept, refine } = scorecard.thresholds;
  const gates: CriticalGate[] = dimensions
    .filter((d) => d.critical)
    .map((d) => ({ dimensionId: d.id, name: d.name, score: d.score, status: d.gate }));
  const failed = gates.filter((g) => g.status === 'failed');
  const pending = dimensions.filter((d) => d.pending);
  const shown = floor1(score);
  const reasons: string[] = [];

  let decision: Decision;
  if (score < refine) {
    decision = 'red';
    reasons.push(`Score ${shown} is below ${refine}.`);
  } else if (score >= accept && failed.length === 0 && pending.length === 0 && blocking.length === 0) {
    decision = 'green';
    reasons.push(`Score ${shown} is at or above ${accept}, every critical gate passed, no high-risk finding is open, and no human-only evidence is outstanding.`);
  } else {
    decision = 'amber';
    if (score < accept) reasons.push(`Score ${shown} is below ${accept}.`);
    for (const gate of failed) {
      reasons.push(`Critical gate ${gate.dimensionId} (${gate.name}) scored ${gate.score ?? 0}, below ${CRITICAL_MINIMUM}.`);
    }
    if (blocking.length > 0) {
      const shownIds = blocking.slice(0, 5).map((f) => f.id).join(', ');
      reasons.push(`${blocking.length} high-risk finding${blocking.length === 1 ? '' : 's'} block${blocking.length === 1 ? 's' : ''} green until fixed: ${shownIds}${blocking.length > 5 ? ' and more' : ''}.`);
    }
    if (pending.length > 0) {
      reasons.push(`A person must supply: ${pending.map((d) => `${d.id} (${d.name})`).join(', ')}.`);
    }
  }
  return { score, decision, criticalGates: gates, reasons };
}

export function buildVerdictSection(
  scorecard: Scorecard,
  dimensions: DimensionResult[],
  evidence: HumanEvidence[],
  override: Override | null,
  findings: Finding[] = [],
): VerdictSection {
  const blocking = blockingFindings(findings);
  const verdict = decide(scorecard, effectiveDimensions(scorecard, dimensions, evidence), blocking);
  const reasons = [...verdict.reasons];
  if (override) {
    reasons.push(`A person overrode the verdict to ${override.decision.toUpperCase()}: ${override.reason}`);
  }
  return {
    weightedScore: floor1(verdict.score),
    decision: override?.decision ?? verdict.decision,
    agentDecision: verdict.decision,
    thresholds: scorecard.thresholds,
    criticalGates: verdict.criticalGates,
    blockingFindings: blocking.map((f) => f.id),
    reasons,
    override,
  };
}
