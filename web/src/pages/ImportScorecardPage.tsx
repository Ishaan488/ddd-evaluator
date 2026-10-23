import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type ImportedScorecard } from '../api';
import { Chip } from '../components/Chip';
import { DropZone } from '../components/DropZone';
import { Icon } from '../components/Icons';
import { Card, ErrorBanner, PageHeader } from '../components/Layout';
import { useDocumentTitle } from '../hooks';

const SOURCE_TYPES = ['.xlsx', '.pdf', '.yaml', '.yml', '.json', '.csv', '.txt', '.md'];

export function ImportScorecardPage() {
  useDocumentTitle('Import a scorecard');
  const navigate = useNavigate();
  const [scorecard, setScorecard] = useState<File | null>(null);
  const [document, setDocument] = useState<File | null>(null);
  const [draft, setDraft] = useState<ImportedScorecard | null>(null);
  const [yaml, setYaml] = useState('');
  const [name, setName] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'checking' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState<string | null>(null);

  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  const read = async () => {
    if (!scorecard) return;
    setBusy('reading');
    setError(null);
    setApproved(null);
    setReviewed(false);
    try {
      const result = await api.importScorecard(scorecard, document);
      setDraft(result);
      setYaml(result.yaml);
    } catch (e) {
      fail(e, 'The scorecard could not be read.');
    }
    setBusy(null);
  };

  const approve = async () => {
    setBusy('checking');
    setError(null);
    try {
      const result = await api.checkScorecard(yaml, name.trim());
      setYaml(result.yaml);
      setApproved(result.yaml);
    } catch (e) {
      fail(e, 'The check failed.');
    }
    setBusy(null);
  };

  const fileOf = (text: string) => new File([text], `${(scorecard?.name ?? 'scorecard').replace(/\.[^.]+$/, '')}-approved.yaml`, { type: 'text/yaml' });
  const download = () => {
    if (!approved) return;
    const url = URL.createObjectURL(fileOf(approved));
    const link = Object.assign(window.document.createElement('a'), { href: url, download: fileOf(approved).name });
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        eyebrow="Scorecards"
        title="Import a scorecard"
        actions={<Link to="/new" className="btn btn-ghost"><Icon name="back" /> New evaluation</Link>}
      >
        Have a scorecard in another layout? Add it here and an AI examiner drafts it in this app’s format. Nothing is marked against it until you
        have compared it with the original and approved it.
      </PageHeader>

      {error && <ErrorBanner message={error} />}

      <div className="stack">
      <Card title="Step 1 · Add your scorecard">
        <div className="drop-pair">
          <DropZone label="Scorecard in any layout" hint="Excel, PDF, YAML, JSON, CSV or text" accept={SOURCE_TYPES} file={scorecard} onFile={setScorecard} icon="list" />
          <DropZone label="The file it will be used on (optional)" hint=".xlsx or .pdf · lets the draft name real pages or sheets" accept={['.xlsx', '.pdf']} file={document} onFile={setDocument} icon="upload" />
        </div>
        <div className="actions-row">
          <button className="btn btn-primary" disabled={!scorecard || busy !== null} onClick={() => void read()}>
            {busy === 'reading' ? 'Reading it…' : 'Read it'} <Icon name="arrow" />
          </button>
          <span className="field-hint">Uses one call to one examiner model. It can take up to a minute.</span>
        </div>
      </Card>

      {draft && (
        <>
          <Card title="Step 2 · Check what it understood">
            <div className="chip-row">
              <Chip tone="accent">{draft.summary.dimensions} questions</Chip>
              <Chip tone="muted">{draft.summary.byExaminers} marked by the examiners</Chip>
              {draft.summary.byCode > 0 && <Chip tone="muted">{draft.summary.byCode} counted by code</Chip>}
              <Chip tone="muted">{draft.summary.byPerson} need a person</Chip>
              <Chip tone="muted">{draft.summary.critical} must-pass</Chip>
              <Chip tone={draft.summary.weightTotal === 100 ? 'muted' : 'amber'}>weights add to {draft.summary.weightTotal}</Chip>
            </div>
            {draft.uncertain.length > 0 && (
              <div className="banner banner-amber">
                <Icon name="alert" />
                <div>
                  <strong>Check these first. The examiner was not sure:</strong>
                  <ul className="plain-list">{draft.uncertain.map((u) => <li key={u}>{u}</li>)}</ul>
                </div>
              </div>
            )}
            {draft.adjustments.length > 0 && (
              <div className="banner">
                <Icon name="info" />
                <div>
                  <strong>What was changed along the way:</strong>
                  <ul className="plain-list">{draft.adjustments.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              </div>
            )}
            <p className="field-hint">Drafted by {draft.model.model} ({draft.model.provider}). It can misread a weight or a rule, so compare with your original below.</p>
          </Card>

          <Card title="The questions it found">
            <div className="table-scroll">
              <table className="table import-table">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Marked by</th>
                    <th className="num">Weight</th>
                    <th>Pages or sheets it reads</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.questions.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <span className="q-id">{q.id}</span> {q.name}
                        {q.critical && <Chip tone="red">must pass</Chip>}
                      </td>
                      <td><Chip tone={q.by === 'person' ? 'amber' : 'accent'}>{q.by === 'person' ? 'A person' : q.by === 'code' ? 'Counted by code' : 'Examiners'}</Chip></td>
                      <td className="num">{q.weight}</td>
                      <td className="faint">{q.by === 'person' ? '—' : q.by === 'code' ? q.how ?? 'whole document' : q.reads.join(', ') || 'not set'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Compare and edit">
            <details className="fold">
              <summary>Your original, as the examiner saw it</summary>
              <pre className="code-block" aria-label="Original scorecard text">{draft.sourceText}</pre>
            </details>
            <details className="fold">
              <summary>Edit the draft (advanced)</summary>
              <textarea className="input textarea code-block" rows={24} value={yaml} onChange={(e) => { setYaml(e.target.value); setApproved(null); }} spellCheck={false} aria-label="Draft scorecard" />
            </details>
          </Card>

          <Card title="Step 3 · Approve it">
            <label className="check-line">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              <span>I compared the draft with the original and it says the same thing.</span>
            </label>
            <div className="field">
              <label className="field-label" htmlFor="approver">Your name</label>
              <input id="approver" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Recorded in every report as the approver" autoComplete="off" />
            </div>
            <div className="actions-row">
              <button className="btn btn-primary" disabled={!reviewed || !name.trim() || busy !== null} onClick={() => void approve()}>
                <Icon name="lock" /> {busy === 'checking' ? 'Checking…' : 'Check and approve'}
              </button>
            </div>
            {approved && (
              <div className="banner banner-green">
                <Icon name="check" />
                <div>
                  <strong>Approved and frozen.</strong> The scorecard is valid and records who approved it.
                  <div className="actions-row">
                    <button className="btn btn-secondary" onClick={download}><Icon name="download" /> Download .yaml</button>
                    <button className="btn btn-primary" onClick={() => navigate('/new', { state: { scorecardFile: fileOf(approved) } })}>
                      Use it in a new evaluation <Icon name="arrow" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
      </div>
    </>
  );
}
