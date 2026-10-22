import type { ParticipantProgress, RunDetail, RunStage } from '@ddd/shared';
import { STATUS_LABEL, formatDuration } from '../format';
import { Icon } from './Icons';

const STEPS: Array<{ stage: RunStage; title: string; detail: string }> = [
  { stage: 'reading', title: 'Freeze the inputs', detail: 'Read the workbook and scorecard, and hash both' },
  { stage: 'checks', title: 'Count in code', detail: 'Exact checks on the countable dimensions' },
  { stage: 'rating', title: 'Three raters score', detail: 'Blind, from three model families' },
  { stage: 'consolidating', title: 'Consolidate', detail: 'A fourth model reconciles the scores' },
  { stage: 'reporting', title: 'Decide and report', detail: 'Verdict by rule, then the eight-section report' },
];

const ORDER: RunStage[] = ['queued', 'reading', 'checks', 'rating', 'consolidating', 'reporting', 'done'];

function Participant({ p }: { p: ParticipantProgress }) {
  return (
    <div className={`participant participant-${p.status}`} title={p.error ?? `${p.provider} / ${p.model}`}>
      <span className="participant-id">{p.id}</span>
      <span className="participant-body">
        <span className="participant-model">{p.model}</span>
        <span className="participant-meta">
          {p.provider} · {p.family}
        </span>
      </span>
      <span className="participant-status">
        {p.status === 'running' && <span className="spinner spinner-sm" />}
        {p.status === 'ok' && <Icon name="check" size={14} />}
        {p.status === 'failed' && <Icon name="x" size={14} />}
        {STATUS_LABEL[p.status]}
        {p.latencyMs !== undefined && p.status !== 'running' && <span className="faint"> · {formatDuration(p.latencyMs)}</span>}
      </span>
    </div>
  );
}

export function Pipeline({ run }: { run: RunDetail }) {
  const at = ORDER.indexOf(run.stage);
  const failed = run.status === 'failed';
  const participants = run.progress?.participants ?? [];

  return (
    <ol className="pipeline">
      {STEPS.map((step, index) => {
        const position = ORDER.indexOf(step.stage);
        const state = failed ? 'idle' : run.status === 'done' || at > position ? 'done' : at === position ? 'active' : 'idle';
        const members =
          step.stage === 'rating'
            ? participants.filter((p) => p.role === 'rater')
            : step.stage === 'consolidating'
              ? participants.filter((p) => p.role === 'consolidator')
              : [];
        return (
          <li key={step.stage} className={`pipe pipe-${state}`}>
            <span className="pipe-node">
              {state === 'done' ? <Icon name="check" size={14} strokeWidth={2.6} /> : state === 'active' ? <span className="pulse" /> : index + 1}
            </span>
            <div className="pipe-body">
              <div className="pipe-title">{step.title}</div>
              <div className="pipe-detail">{step.detail}</div>
              {members.length > 0 && (
                <div className="participants">
                  {members.map((p) => (
                    <Participant key={p.id} p={p} />
                  ))}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
