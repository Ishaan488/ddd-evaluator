import type { Decision, MeasuredBy, Severity } from '@ddd/shared';
import { DECISION_LABEL, SEVERITY_LABEL } from '../format';
import type { ReactNode } from 'react';

export function DecisionChip({ decision, size = 'md' }: { decision: Decision | null; size?: 'sm' | 'md' | 'lg' }) {
  if (!decision) return <span className="chip chip-muted">No verdict</span>;
  return (
    <span className={`chip chip-${decision} chip-${size}`}>
      <span className="chip-dot" />
      {DECISION_LABEL[decision]}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const tone = severity === 'HIGH' ? 'red' : severity === 'MEDIUM' ? 'amber' : 'muted';
  const title = severity === 'HIGH' ? 'Blocks green. Must be fixed before resubmission.' : severity === 'MEDIUM' ? 'Fix in this pass, or record why it is deferred.' : 'An improvement. Fix when convenient.';
  return <span className={`chip chip-${tone} chip-sm`} title={title}>{SEVERITY_LABEL[severity]}</span>;
}

const BY_LABEL: Record<MeasuredBy, string> = { code: 'Computer', raters: 'AI examiners', human: 'A person' };

export function ByChip({ by }: { by: MeasuredBy }) {
  return <span className={`chip chip-by chip-by-${by} chip-sm`}>{BY_LABEL[by]}</span>;
}

export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'green' | 'amber' | 'red' | 'blue' }) {
  return <span className={`chip chip-${tone} chip-sm`}>{children}</span>;
}

/** Where the evidence is. In a PDF a "cell" is a line on a page (A42 = line 42), so say that in words. */
export function CellChip({ sheet, cell }: { sheet: string; cell: string }) {
  const line = /^Page \d+$/.test(sheet) ? /^A(\d+)$/.exec(cell)?.[1] : undefined;
  return (
    <span className="cell-chip mono" title={line ? `${sheet}, line ${line}` : `${sheet}, cell ${cell}`}>
      <span className="cell-chip-sheet">{sheet}</span>
      <span className="cell-chip-cell">{line ? `line ${line}` : cell}</span>
    </span>
  );
}
