import { useState, type FormEvent } from 'react';
import type { NotMeasurableItem, RunDetail } from '@ddd/shared';
import { api, ApiError } from '../../api';
import { Chip } from '../../components/Chip';
import { Icon } from '../../components/Icons';
import { useStoredText } from '../../hooks';

function EvidenceForm({ run, item, onChange }: { run: RunDetail; item: NotMeasurableItem; onChange: (run: RunDetail) => void }) {
  const [score, setScore] = useState<string>('');
  const [note, setNote] = useState('');
  const [by, setBy] = useStoredText('ddd.person');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await api.addEvidence(run.id, { dimensionId: item.dimensionId, score: score === '' ? null : Number(score), note, by }));
      setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="evidence-form" onSubmit={save}>
      <div className="evidence-fields">
        <div className="field field-narrow">
          <label className="field-label" htmlFor={`score-${item.dimensionId}`}>Score</label>
          <select id={`score-${item.dimensionId}`} className="input input-sm" value={score} onChange={(e) => setScore(e.target.value)}>
            <option value="">No score</option>
            {[5, 4, 3, 2, 1, 0].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="field field-grow">
          <label className="field-label" htmlFor={`note-${item.dimensionId}`}>Evidence</label>
          <input id={`note-${item.dimensionId}`} className="input input-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: interview held 22 Oct, author explained the tree unaided" required />
        </div>
        <div className="field field-narrow">
          <label className="field-label" htmlFor={`by-${item.dimensionId}`}>By</label>
          <input id={`by-${item.dimensionId}`} className="input input-sm" value={by} onChange={(e) => setBy(e.target.value)} required />
        </div>
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || note.trim().length < 3 || !by.trim()}>
          {item.evidence ? 'Update' : 'Record'}
        </button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}

export function NotMeasurable({ run, onChange }: { run: RunDetail; onChange: (run: RunDetail) => void }) {
  const items = run.report!.notMeasurable;
  if (items.length === 0) {
    return <p className="muted">Every dimension in this scorecard was measured by code or by the raters.</p>;
  }
  return (
    <>
      <p className="muted lead">
        A deliverable cannot turn green until a person supplies this evidence. Record it here; the verdict updates straight away and the agent’s own scores are never changed.
      </p>
      <ul className="human">
        {items.map((item) => (
          <li key={item.dimensionId} className={`human-item ${item.evidence ? 'human-done' : ''}`}>
            <div className="human-head">
              <span className="mono faint">{item.dimensionId}</span>
              <h3>{item.name}</h3>
              {item.critical && <span className="crit" title="Critical gate">★</span>}
              {item.evidence ? <Chip tone="green"><Icon name="check" size={11} strokeWidth={2.6} /> Supplied</Chip> : <Chip tone="amber">Outstanding</Chip>}
              <span className="faint human-weight">weight {item.weight}</span>
            </div>
            <p className="human-why">{item.reason} {item.whatIsNeeded}</p>
            {item.evidence && (
              <p className="human-have">
                <strong>{item.evidence.by}</strong>{item.evidence.score !== null && <> scored it <span className="mono">{item.evidence.score}</span></>}: {item.evidence.note}
              </p>
            )}
            <EvidenceForm run={run} item={item} onChange={onChange} />
          </li>
        ))}
      </ul>
    </>
  );
}
