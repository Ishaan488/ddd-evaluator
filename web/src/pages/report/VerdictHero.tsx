import { useState } from 'react';
import type { RunDetail } from '@ddd/shared';
import { Chip, DecisionChip } from '../../components/Chip';
import { ScoreRing, ThresholdBar } from '../../components/Charts';
import { Icon } from '../../components/Icons';
import { DECISION_MEANING } from '../../format';
import { OverrideDialog } from './OverrideDialog';

export function VerdictHero({ run, onChange }: { run: RunDetail; onChange: (run: RunDetail) => void }) {
  const [overriding, setOverriding] = useState(false);
  const { verdict, header } = run.report!;
  const { override } = verdict;
  const unapproved = /pending|draft/i.test(header.scorecardApproval ?? '');

  return (
    <section id="verdict" className={`hero hero-${verdict.decision}`}>
      <div className="hero-main">
        <ScoreRing score={verdict.weightedScore} decision={verdict.decision} />
        <div className="hero-copy">
          <div className="hero-top">
            <DecisionChip decision={verdict.decision} size="lg" />
            {override && <Chip tone="amber">Overridden by {override.by}</Chip>}
          </div>
          <p className="hero-line">{DECISION_MEANING[verdict.decision]}</p>
          <ul className="reasons">
            {verdict.reasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
          <ThresholdBar score={verdict.weightedScore} refine={verdict.thresholds.refine} accept={verdict.thresholds.accept} decision={verdict.decision} />
        </div>
      </div>

      <aside className="hero-side">
        <h3>Critical gates <span className="faint">need 4 or more</span></h3>
        {verdict.criticalGates.length === 0 ? (
          <p className="muted">This scorecard has no critical gates.</p>
        ) : (
          <ul className="gates">
            {verdict.criticalGates.map((g) => (
              <li key={g.dimensionId} className={`gate gate-${g.status}`}>
                <span className="gate-icon">
                  <Icon name={g.status === 'passed' ? 'check' : g.status === 'failed' ? 'x' : 'clock'} size={13} strokeWidth={2.4} />
                </span>
                <span className="gate-name"><span className="mono faint">{g.dimensionId}</span> {g.name}</span>
                <span className="gate-score mono">{g.score === null ? 'pending' : g.score}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setOverriding(true)}>
          <Icon name="flag" /> {override ? 'Change override' : 'Override verdict'}
        </button>
      </aside>

      {(override || unapproved) && (
        <div className="hero-notes">
          {override && (
            <div className="banner banner-amber">
              <Icon name="flag" />
              <span>
                The agent’s verdict was <strong>{verdict.agentDecision.toUpperCase()}</strong>. {override.by} overrode it to <strong>{override.decision.toUpperCase()}</strong>: {override.reason}
              </span>
            </div>
          )}
          {unapproved && (
            <div className="banner banner-amber">
              <Icon name="lock" />
              <span>Scorecard approval: <strong>{header.scorecardApproval}</strong>. Treat this verdict as provisional until the scorecard is approved.</span>
            </div>
          )}
        </div>
      )}

      {overriding && (
        <OverrideDialog
          run={run}
          onClose={() => setOverriding(false)}
          onSaved={(next) => {
            onChange(next);
            setOverriding(false);
          }}
        />
      )}
    </section>
  );
}
