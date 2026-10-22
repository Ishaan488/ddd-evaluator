import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Decision, RunDetail } from '@ddd/shared';
import { api, ApiError } from '../../api';
import { DECISION_LABEL } from '../../format';
import { useStoredText } from '../../hooks';

export function OverrideDialog({ run, onClose, onSaved }: { run: RunDetail; onClose: () => void; onSaved: (run: RunDetail) => void }) {
  const current = run.report!.verdict;
  const [decision, setDecision] = useState<Decision>(current.override?.decision ?? current.agentDecision);
  const [reason, setReason] = useState('');
  const [by, setBy] = useStoredText('ddd.person');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.override(run.id, { decision, reason, by }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the override.');
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <form onSubmit={save} className="dialog-body">
        <h2>Override the verdict</h2>
        <p className="muted">
          Agents recommend and people decide. An override can go up or down, but it needs a written reason, and overrides are reviewed during calibration.
          The agent’s own verdict (<strong>{DECISION_LABEL[current.agentDecision]}</strong>) stays on record.
        </p>

        <fieldset className="choice">
          <legend className="field-label">New verdict</legend>
          {(['green', 'amber', 'red'] as const).map((d) => (
            <label key={d} className={`choice-item choice-${d} ${decision === d ? 'choice-on' : ''}`}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} />
              {DECISION_LABEL[d]}
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label className="field-label" htmlFor="ov-reason">Reason</label>
          <textarea id="ov-reason" className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the agent’s verdict being changed?" required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ov-by">Your name</label>
          <input id="ov-by" className="input" value={by} onChange={(e) => setBy(e.target.value)} required />
        </div>
        {error && <p className="field-error">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length < 5 || !by.trim()}>Save override</button>
        </div>
      </form>
    </dialog>
  );
}
