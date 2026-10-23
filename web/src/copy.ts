/**
 * Every word the dashboard uses to explain itself, in one place. The rule: plain words first. Where the
 * Agentic Roadmap PDF has its own term (green/amber/red, path to green), the plain version keeps it visible.
 */
import type { Decision, DimensionResult, MeasuredBy, Resolution, Severity } from '@ddd/shared';

export const VERDICT: Record<Decision, { label: string; headline: string; body: string }> = {
  green: {
    label: 'Green',
    headline: 'Looks good',
    body: 'This passes. A person confirms it before it moves on to the next step.',
  },
  amber: {
    label: 'Amber',
    headline: 'Almost there',
    body: 'Fix the problems below and submit it again. A person looks at every amber result.',
  },
  red: {
    label: 'Red',
    headline: 'Not there yet',
    body: 'The score is too low. Work through the problems below. If the structure itself is off, go back to the Define step with your mentor.',
  },
};

/** Terms that need a one-line explanation. `help` is shown as a tooltip next to the term. */
export const TERMS = {
  mustPass: {
    label: 'Must-pass checks',
    help: 'These checks cannot fail. Each needs 4 out of 5 or more, or the result can never be green, however high the total score is.',
  },
  importance: {
    label: 'Importance',
    help: 'How much this check counts towards the total score. A check with importance 10 counts twice as much as one with 5.',
  },
  disagreement: {
    label: 'Disagreement',
    help: 'The gap between the highest and the lowest score the AI examiners gave. 0 means they all gave the same score.',
  },
  examiner: {
    label: 'Examiner',
    help: 'An AI model that scores this work on its own, without seeing the others. Three different models score every judgement.',
  },
  finalReviewer: {
    label: 'Final reviewer',
    help: 'A fourth AI model that compares the three examiners’ scores. It cannot invent a score outside what they gave.',
  },
  score: {
    label: 'Score',
    help: 'Out of 5. Green means 4 or 5, amber 3, red 2 or less.',
  },
} as const;

export const METHOD: Record<MeasuredBy, { label: string; group: string; blurb: string }> = {
  code: {
    label: 'Computer',
    group: 'Checked by the computer',
    blurb: 'Counted exactly by the program, so there is no guessing and the same file always gives the same answer.',
  },
  raters: {
    label: 'AI examiners',
    group: 'Scored by the AI examiners',
    blurb: 'Judgement calls. Three different AI models score each one on their own, and every score has to point at a real cell.',
  },
  human: {
    label: 'A person',
    group: 'Needs a person',
    blurb: 'Things no program can judge, like an interview with the author. A result cannot be green until someone supplies them.',
  },
};

export const SEVERITY: Record<Severity, { label: string; plural: string; help: string }> = {
  HIGH: { label: 'Must fix', plural: 'must fix', help: 'High risk. This blocks green until it is fixed.' },
  MEDIUM: { label: 'Should fix', plural: 'should fix', help: 'Medium risk. Fix it in this round, or note why it is waiting.' },
  LOW: { label: 'Nice to fix', plural: 'nice to fix', help: 'Low risk. An improvement to make when convenient.' },
};

export const RESOLUTION: Record<Resolution, { label: string; tone: 'green' | 'accent' | 'amber' | 'muted'; text: string }> = {
  agreement: { label: 'Agreed', tone: 'green', text: 'All the examiners were within one point of each other.' },
  claims_checked: {
    label: 'Settled',
    tone: 'accent',
    text: 'They differed by more than one point, so the final reviewer checked each claim against the file.',
  },
  lower_stands: {
    label: 'Lower score kept',
    tone: 'amber',
    text: 'They differed and the file could not settle it, so the lower score was kept. Please take a look.',
  },
  single_rater: { label: 'One examiner only', tone: 'amber', text: 'Only one examiner gave a usable score. Please take a look.' },
  code: { label: 'Counted', tone: 'muted', text: 'Counted by the computer.' },
  none: { label: '—', tone: 'muted', text: '' },
};

/** What to show in the "status" column of the scores table. */
export function statusOf(d: DimensionResult): { label: string; tone: 'green' | 'accent' | 'amber' | 'red' | 'muted' | 'blue'; help: string } {
  if (d.status === 'unscored') return { label: 'Could not be scored', tone: 'red', help: d.error ?? 'No examiner produced a score that pointed at a real cell, so it counts as 0.' };
  if (d.status === 'not_measurable') return { label: 'Needs your input', tone: 'amber', help: 'Only a person can supply this.' };
  if (d.flagged) return { label: 'Needs a second look', tone: 'amber', help: RESOLUTION[d.resolution].text };
  if (d.measuredBy === 'code') return { label: 'Checked', tone: 'blue', help: METHOD.code.blurb };
  if (d.confidence === 'shaky') return { label: 'Scores differ', tone: 'amber', help: 'The examiners, or repeat runs by the same examiner, gave scores more than a point apart. Treat this score with care.' };
  return { label: 'Examiners agreed', tone: 'accent', help: RESOLUTION[d.resolution].text };
}

/** The stages of a run, in plain words. */
export const STAGES = [
  { stage: 'reading', title: 'Locking your files', detail: 'Reading the workbook and scorecard and taking a fingerprint of each, so nothing can change mid-way' },
  { stage: 'checks', title: 'Checking the facts', detail: 'Counting what can be counted exactly: blanks, duplicates, allowed values' },
  { stage: 'rating', title: 'Three AI examiners mark it', detail: 'Each scores the judgement questions alone, from a different model family' },
  { stage: 'consolidating', title: 'Final review', detail: 'A fourth model compares the three sets of marks' },
  { stage: 'reporting', title: 'Writing the report', detail: 'The result is decided by rule, then the report and the path to green are built' },
] as const;

export const STAGE_NAMES: Record<string, string> = {
  Discover: 'Discover',
  Define: 'Define',
  Generate: 'Generate',
  Analyse: 'Analyse',
  Validate: 'Validate',
  Refine: 'Refine',
};

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The server writes its reasons in the PDF's words; this softens them without changing what they say. */
export const friendlyReason = (text: string): string =>
  text
    .replace(/Critical gate (\S+) \((.*?)\) scored/g, 'Must-pass check $1 ($2) scored')
    .replace(/(\d+) high-risk findings? blocks? green until fixed/g, (_m, n: string) => `${n} must-fix ${n === '1' ? 'problem blocks' : 'problems block'} green until fixed`)
    .replace(/A person must supply:/g, 'A person still has to supply:');
