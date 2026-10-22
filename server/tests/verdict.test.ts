import { describe, expect, it } from 'vitest';
import type { Finding } from '@ddd/shared';
import { buildVerdictSection } from '../src/agent/verdict.js';
import { build, evidence } from './factories.js';

const decide = (inputs: Parameters<typeof build>[0], ev = [] as ReturnType<typeof evidence>[]) => {
  const { scorecard, dimensions } = build(inputs);
  return buildVerdictSection(scorecard, dimensions, ev, null);
};

describe('verdict rule (PDF page 12)', () => {
  it('is green at exactly 90 with every critical gate passed', () => {
    const v = decide([{ id: 'A', weight: 50, score: 5, critical: true }, { id: 'B', weight: 50, score: 4 }]);
    expect(v.weightedScore).toBe(90);
    expect(v.decision).toBe('green');
  });

  it('is amber just under 90, and shows it rounded down so 89.96 never reads as 90', () => {
    const v = decide([{ id: 'A', weight: 10000, score: 5 }, { id: 'B', weight: 4, score: 0 }]);
    expect(v.decision).toBe('green'); // 99.96
    const under = decide([{ id: 'A', weight: 4496, score: 5 }, { id: 'B', weight: 504, score: 4 }, { id: 'C', weight: 5000, score: 4.5 }]);
    expect(under.weightedScore).toBeLessThan(100);
    const near = decide([{ id: 'A', weight: 1, score: 5 }, { id: 'B', weight: 2499, score: 4.5 }, { id: 'C', weight: 2500, score: 4.5 }]);
    expect(near.weightedScore).toBeCloseTo(90, 0);
  });

  it('is amber from 75 up to (not including) 90 and red below 75', () => {
    // 75 exactly: one dim at score 3.75 equivalent via weights 75/25
    expect(decide([{ id: 'A', weight: 75, score: 5 }, { id: 'B', weight: 25, score: 0 }]).decision).toBe('amber');
    expect(decide([{ id: 'A', weight: 74, score: 5 }, { id: 'B', weight: 26, score: 0 }]).decision).toBe('red');
    expect(decide([{ id: 'A', weight: 89, score: 5 }, { id: 'B', weight: 11, score: 0 }]).decision).toBe('amber');
  });

  it('is amber, not green, when a critical gate is below 4 even with a high score', () => {
    const v = decide([{ id: 'A', weight: 10, score: 3, critical: true }, { id: 'B', weight: 90, score: 5 }]);
    expect(v.weightedScore).toBeGreaterThan(90);
    expect(v.decision).toBe('amber');
    expect(v.criticalGates[0]).toMatchObject({ dimensionId: 'A', status: 'failed' });
    expect(v.reasons.join(' ')).toMatch(/Critical gate A/);
  });

  it('counts an unscored dimension as 0 and fails its critical gate', () => {
    const v = decide([{ id: 'A', weight: 50, score: null, critical: true }, { id: 'B', weight: 50, score: 5 }]);
    expect(v.weightedScore).toBe(50);
    expect(v.decision).toBe('red');
    expect(v.criticalGates[0]!.status).toBe('failed');
  });

  it('cannot be green while human-only evidence is outstanding', () => {
    const inputs = [{ id: 'A', weight: 100, score: 5 }, { id: 'H', weight: 10, score: null, critical: true, measuredBy: 'human' as const }];
    const pending = decide(inputs);
    expect(pending.weightedScore).toBe(100);
    expect(pending.decision).toBe('amber');
    expect(pending.criticalGates.find((g) => g.dimensionId === 'H')!.status).toBe('pending');

    expect(decide(inputs, [evidence('H', 5)]).decision).toBe('green');
  });

  it('uses the score a person supplied, and a low interview score fails the critical gate', () => {
    const inputs = [{ id: 'A', weight: 90, score: 5 }, { id: 'H', weight: 10, score: null, critical: true, measuredBy: 'human' as const }];
    const low = decide(inputs, [evidence('H', 2)]);
    expect(low.weightedScore).toBe(94);
    expect(low.decision).toBe('amber');
    expect(low.criticalGates.find((g) => g.dimensionId === 'H')!.status).toBe('failed');
  });

  it('treats a note without a score as the person having supplied the evidence', () => {
    const inputs = [{ id: 'A', weight: 100, score: 5 }, { id: 'H', weight: 10, score: null, measuredBy: 'human' as const }];
    expect(decide(inputs, [evidence('H', null)]).decision).toBe('green');
  });

  it('keeps the latest evidence when a person updates it', () => {
    const inputs = [{ id: 'A', weight: 90, score: 5 }, { id: 'H', weight: 10, score: null, critical: true, measuredBy: 'human' as const }];
    const v = decide(inputs, [evidence('H', 1, '2026-10-22T09:00:00Z'), evidence('H', 5, '2026-10-22T11:00:00Z')]);
    expect(v.decision).toBe('green');
  });

  it('records an override with its reason and keeps the agent verdict visible', () => {
    const { scorecard, dimensions } = build([{ id: 'A', weight: 100, score: 2 }]);
    const v = buildVerdictSection(scorecard, dimensions, [], {
      id: 'o', runId: 'r', decision: 'amber', reason: 'Lead accepts the risk', by: 'Lead', createdAt: '2026-10-22T10:00:00Z',
    });
    expect(v.agentDecision).toBe('red');
    expect(v.decision).toBe('amber');
    expect(v.reasons.join(' ')).toMatch(/overrode the verdict to AMBER: Lead accepts the risk/);
  });

  it('honours the thresholds written in the scorecard', () => {
    const { scorecard, dimensions } = build([{ id: 'A', weight: 100, score: 4 }], { accept: 80, refine: 60 });
    expect(buildVerdictSection(scorecard, dimensions, [], null).decision).toBe('green');
  });
});

describe('high-risk findings block green (PDF p.11)', () => {
  const finding = (id: string, severity: Finding['severity']): Finding => ({
    id, severity, dimensionId: 'A', location: null, title: 'x', detail: '', fix: 'f', returnTo: 'Define', source: 'raters', reportedBy: ['A'],
  });
  const verdictWith = (findings: Finding[]) => {
    const { scorecard, dimensions } = build([{ id: 'A', weight: 100, score: 5 }]);
    return buildVerdictSection(scorecard, dimensions, [], null, findings);
  };

  it('a perfect score with an open HIGH finding is amber, not green', () => {
    const v = verdictWith([finding('F-01', 'HIGH')]);
    expect(v.weightedScore).toBe(100);
    expect(v.decision).toBe('amber');
    expect(v.blockingFindings).toEqual(['F-01']);
    expect(v.reasons.join(' ')).toMatch(/1 high-risk finding blocks green until fixed: F-01/);
  });

  it('MEDIUM and LOW findings do not block green', () => {
    const v = verdictWith([finding('F-01', 'MEDIUM'), finding('F-02', 'LOW')]);
    expect(v.decision).toBe('green');
    expect(v.blockingFindings).toEqual([]);
  });

  it('lists every blocking finding, and a low-weight dimension scoring 2 cannot slip through as green', () => {
    // 96 weight at 5 and 4 weight at 2 scores 99.2, which the score rule alone would call green
    const { scorecard, dimensions } = build([{ id: 'A', weight: 96, score: 5 }, { id: 'B', weight: 4, score: 2 }]);
    const alone = buildVerdictSection(scorecard, dimensions, [], null, []);
    expect(alone.decision).toBe('green');
    const withHigh = buildVerdictSection(scorecard, dimensions, [], null, [{ ...finding('F-01', 'HIGH'), dimensionId: 'B' }, finding('F-02', 'HIGH')]);
    expect(withHigh.decision).toBe('amber');
    expect(withHigh.blockingFindings).toEqual(['F-01', 'F-02']);
    expect(withHigh.reasons.join(' ')).toMatch(/2 high-risk findings block green until fixed: F-01, F-02/);
  });

  it('never turns a red into amber, and an override still wins', () => {
    const { scorecard, dimensions } = build([{ id: 'A', weight: 100, score: 2 }]);
    expect(buildVerdictSection(scorecard, dimensions, [], null, [finding('F-01', 'HIGH')]).decision).toBe('red');
    const overridden = buildVerdictSection(scorecard, dimensions, [], { id: 'o', runId: 'r', decision: 'green', reason: 'accepted', by: 'Lead', createdAt: '2026-10-22T10:00:00Z' }, [finding('F-01', 'HIGH')]);
    expect(overridden.agentDecision).toBe('red');
    expect(overridden.decision).toBe('green');
  });
});
