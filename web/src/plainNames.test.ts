import { describe, expect, it } from 'vitest';
import type { DimensionResult, Report } from '@ddd/shared';
import { statusOf } from './copy';
import { plainName, simplifyReport } from './plainNames';

describe('plain names', () => {
  it('drops the gate tag and says what a counted part is', () => {
    expect(plainName('Field-definition quality · GATE')).toBe('Field-definition quality');
    expect(plainName('Purpose, scope and clarity (counted)')).toBe('Purpose, scope and clarity (numbers to check)');
    expect(plainName('Tree depth')).toBe('Tree depth');
  });

  it('rewrites sentences so they name the question and not its code', () => {
    const dim = (id: string, name: string) => ({ id, name });
    const report = {
      dimensions: [dim('G09', 'Privacy and regulatory compliance'), dim('G01-counted', 'Purpose (counted)'), dim('H01', 'Author understanding')],
      agreement: [],
      notMeasurable: [],
      verdict: {
        reasons: ['Must-pass check G09 (Privacy and regulatory compliance) scored 3, below 4.', 'A person still has to supply: G01-counted (Purpose (counted)), H01 (Author understanding).'],
        criticalGates: [],
      },
      pathToGreen: { steps: [], needsPerson: ['H01 · Author understanding'], note: 'Done.' },
    } as unknown as Report;
    const out = simplifyReport(report);
    expect(out.verdict.reasons[0]).toBe('Must-pass check Privacy and regulatory compliance scored 3, below 4.');
    expect(out.verdict.reasons[1]).toBe('A person still has to supply: Purpose (numbers to check), Author understanding.');
    expect(out.pathToGreen.needsPerson).toEqual(['Author understanding']);
    expect(out.dimensions[1]!.name).toBe('Purpose (numbers to check)');
    expect(out.dimensions[1]!.id).toBe('G01-counted');
  });
});

describe('how a judged score is described', () => {
  const base = { id: 'D', name: 'n', weight: 1, critical: false, measuredBy: 'raters', status: 'scored', raterScores: {}, consolidated: 4, spread: 0, resolution: 'agreement', flagged: false, rationale: '', evidence: [] } as unknown as DimensionResult;
  it('says when the scores differ, and when they agree', () => {
    expect(statusOf({ ...base, confidence: 'steady' }).label).toBe('Examiners agreed');
    expect(statusOf({ ...base, confidence: 'shaky' }).label).toBe('Scores differ');
    expect(statusOf({ ...base, confidence: 'single', flagged: true, resolution: 'single_rater' }).label).toBe('Needs a second look');
  });
});
