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
          <label className="field-label" htmlFor={`score-${item.dimensionId}`}>Score (0-5)</label>
          <select id={`score-${item.dimensionId}`} className="input input-sm" value={score} onChange={(e) => setScore(e.target.value)}>
            <option value="">No score</option>
            {[5, 4, 3, 2, 1, 0].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="field field-grow">
          <label className="field-label" htmlFor={`note-${item.dimensionId}`}>What you found</label>
          <input id={`note-${item.dimensionId}`} className="input input-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: interview held 22 Oct, author explained the tree unaided" required />
        </div>
        <div className="field field-narrow">
          <label className="field-label" htmlFor={`by-${item.dimensionId}`}>Your name</label>
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
    return <p className="muted">Nothing here needs a person. The computer and the AI examiners covered everything.</p>;
  }
  return (
    <>
      <p className="muted lead">
        The result cannot be green until a person supplies these. Add them here and the result updates straight away. The agent’s own scores are never changed.
      </p>
      <ul className="human">
        {items.map((item) => (
          <li key={item.dimensionId} className={`human-item ${item.evidence ? 'human-done' : ''}`}>
            <div className="human-head">
              <h3>{item.name}</h3>
              {item.critical && <span className="crit" title="Must-pass check">★</span>}
              {item.evidence ? <Chip tone="green"><Icon name="check" size={11} strokeWidth={2.6} /> Supplied</Chip> : <Chip tone="amber">Still needed</Chip>}
              <span className="faint human-weight">importance {item.weight}</span>
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
