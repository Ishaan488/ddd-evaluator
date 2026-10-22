import { useState } from 'react';
import type { RunDetail } from '@ddd/shared';
import { Chip, DecisionChip } from '../../components/Chip';
import { ScoreRing, ThresholdBar } from '../../components/Charts';
import { Hint } from '../../components/Hint';
import { Icon } from '../../components/Icons';
import { TERMS, VERDICT, friendlyReason } from '../../copy';
import { OverrideDialog } from './OverrideDialog';

export function VerdictHero({ run, onChange }: { run: RunDetail; onChange: (run: RunDetail) => void }) {
  const [overriding, setOverriding] = useState(false);
  const { verdict, header } = run.report!;
  const { override } = verdict;
  const copy = VERDICT[verdict.decision];
  const unapproved = /pending|draft/i.test(header.scorecardApproval ?? '');

  return (
    <section id="verdict" className={`hero hero-${verdict.decision}`} aria-labelledby="hero-title">
      <div className="hero-main">
        <ScoreRing score={verdict.weightedScore} decision={verdict.decision} />
        <div className="hero-copy">
          <div className="hero-top">
            <DecisionChip decision={verdict.decision} size="lg" />
            {override && <Chip tone="amber">Changed by {override.by}</Chip>}
          </div>
          <h2 id="hero-title" className="hero-title">{copy.headline}</h2>
          <p className="hero-line">{copy.body}</p>

          <div className="hero-why">
            <h3>Why this result</h3>
            <ul className="reasons">
              {verdict.reasons.map((reason, i) => (
                <li key={i}>{friendlyReason(reason)}</li>
              ))}
            </ul>
          </div>

          <ThresholdBar score={verdict.weightedScore} refine={verdict.thresholds.refine} accept={verdict.thresholds.accept} decision={verdict.decision} />
          <div className="threshold-caption">
            <span><i className="swatch swatch-red" /> Red below {verdict.thresholds.refine}</span>
            <span><i className="swatch swatch-amber" /> Amber {verdict.thresholds.refine} to {verdict.thresholds.accept - 1}</span>
            <span><i className="swatch swatch-green" /> Green {verdict.thresholds.accept}+</span>
          </div>
        </div>
      </div>

      <aside className="hero-side" aria-label="Must-pass checks">
        <h3>
          <span>{TERMS.mustPass.label} <Hint text={TERMS.mustPass.help} align="left" /></span>
          <span className="faint">need 4 of 5</span>
        </h3>
        {verdict.criticalGates.length === 0 ? (
          <p className="muted">This scorecard has no must-pass checks.</p>
        ) : (
          <ul className="gates">
            {verdict.criticalGates.map((g) => (
              <li key={g.dimensionId} className={`gate gate-${g.status}`}>
                <span className="gate-icon">
                  <Icon name={g.status === 'passed' ? 'check' : g.status === 'failed' ? 'x' : 'clock'} size={13} strokeWidth={2.6} />
                </span>
                <span className="gate-name">{g.name}</span>
                <span className="gate-score">{g.score === null ? 'waiting' : `${g.score} / 5`}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setOverriding(true)}>
          <Icon name="flag" /> {override ? 'Change the override' : 'Change the result'}
        </button>
        <p className="hero-side-note">A person can change the result up or down, with a written reason. The agent’s own answer stays on record.</p>
      </aside>

      {(override || unapproved) && (
        <div className="hero-notes">
          {override && (
            <div className="banner banner-amber">
              <Icon name="flag" />
              <span>
                The agent’s own result was <strong>{verdict.agentDecision.toUpperCase()}</strong>. {override.by} changed it to <strong>{override.decision.toUpperCase()}</strong>: {override.reason}
              </span>
            </div>
          )}
          {unapproved && (
            <div className="banner banner-amber">
              <Icon name="lock" />
              <span>
                Scorecard approval: <strong>{header.scorecardApproval}</strong>. Treat this result as provisional until the scorecard is approved.
              </span>
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
