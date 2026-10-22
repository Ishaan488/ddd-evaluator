import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Chip } from '../components/Chip';
import { DropZone } from '../components/DropZone';
import { Icon } from '../components/Icons';
import { Card, ErrorBanner, PageHeader } from '../components/Layout';
import { useDocumentTitle, useResource } from '../hooks';

const hasExtension = (file: File | null, extensions: string[]) => !file || extensions.some((e) => file.name.toLowerCase().endsWith(e));

export function NewEvaluationPage() {
  useDocumentTitle('New check');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const config = useResource(api.config, []);
  const projects = useResource(api.projects, []);

  const [projectName, setProjectName] = useState(params.get('project') ?? '');
  const [workbook, setWorkbook] = useState<File | null>(null);
  const [scorecard, setScorecard] = useState<File | null>(null);
  const [sources, setSources] = useState('');
  const [instructions, setInstructions] = useState('');
  const [frozenWarning, setFrozenWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFrozenWarning(false);
    // An Excel scorecard is checked on the server; only text scorecards can be peeked at here.
    if (!scorecard || /\.xlsx$/i.test(scorecard.name)) return;
    void scorecard.text().then((text) => setFrozenWarning(!/frozen\s*:\s*true/i.test(text)));
  }, [scorecard]);

  const existing = useMemo(() => projects.data?.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase()), [projects.data, projectName]);
  const workbookOk = hasExtension(workbook, ['.xlsx']);
  const scorecardOk = hasExtension(scorecard, ['.xlsx', '.yaml', '.yml', '.json']);
  const ready = config.data?.ready ?? false;
  const canSubmit = Boolean(workbook && scorecard && workbookOk && scorecardOk && ready && !busy);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!workbook || !scorecard) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.submit({ workbook, scorecard, projectName: projectName.trim(), sources, instructions });
      navigate(`/runs/${created.runId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The submission failed.');
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Evaluate"
        title="Check a new file"
        actions={
          <Link to="/" className="btn btn-ghost">
            <Icon name="back" /> Projects
          </Link>
        }
      >
        Add your Excel file and the scorecard it should be marked against. Nothing in your files is ever changed.
      </PageHeader>

      {error && <ErrorBanner message={error} />}

      <form className="split" onSubmit={submit}>
        <div className="stack">
          <Card title="Step 1 · Add your files">
            <div className="field">
              <label className="field-label" htmlFor="project">Project name</label>
              <input
                id="project"
                className="input"
                list="project-names"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Defaults to the workbook’s file name"
                autoComplete="off"
              />
              <datalist id="project-names">
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
              <span className="field-hint">
                {existing ? (
                  <>
                    <Chip tone="accent">Iteration {existing.runCount + 1}</Chip> This adds a new iteration to <strong>{existing.name}</strong>, so its trend continues.
                  </>
                ) : (
                  'Reuse an existing name to add a new iteration to that project.'
                )}
              </span>
            </div>

            <DropZone label="Your Excel file" hint=".xlsx · the file to be checked" accept={['.xlsx']} file={workbook} onFile={setWorkbook} icon="upload" error={workbookOk ? null : 'This has to be an .xlsx file.'} />
            <DropZone label="Scorecard" hint=".xlsx, .yaml or .json · how it gets marked" accept={['.xlsx', '.yaml', '.yml', '.json']} file={scorecard} onFile={setScorecard} icon="list" error={scorecardOk ? null : 'Use an .xlsx, .yaml or .json scorecard.'} />
            <p className="field-hint template-hint">
              No scorecard yet?
              <a className="link-quiet" href={api.scorecardTemplateUrl} download>
                <Icon name="download" size={13} /> Download the Excel template
              </a>
              <span className="faint">Fill it in, set frozen to yes, and upload it here.</span>
            </p>
            {frozenWarning && (
              <div className="banner banner-amber">
                <Icon name="lock" />
                <span>This scorecard does not say <code>frozen: true</code>. The evaluator will refuse it until it is frozen, so the target cannot move.</span>
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="instructions">Anything the examiners should know <span className="optional">optional</span></label>
              <textarea
                id="instructions"
                className="input textarea"
                rows={4}
                maxLength={4000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="For example: Pay special attention to the Definition column. Treat the Example column as out of scope."
              />
              <span className="field-hint">
                Given to all three examiners and the final reviewer, and saved with the result. They steer what to look at; they can never change
                the 0 to 5 scale, the evidence rule or the scorecard.
                <span className="faint counter">{instructions.length} / 4000</span>
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="sources">Background documents <span className="optional">optional</span></label>
              <textarea id="sources" className="input textarea" rows={5} value={sources} onChange={(e) => setSources(e.target.value)} placeholder="Paste the problem statement or requirements docket the work should be judged against." />
            </div>
          </Card>
        </div>

        <aside className="stack">
          <Card title="Who will mark it" aside={config.data?.mock ? <Chip tone="amber">Mock</Chip> : undefined}>
            {config.data && (
              <ul className="roster">
                {[...config.data.raters, config.data.consolidator].map((m, i) => (
                  <li key={m.id} className="roster-item">
                    <span className={`roster-id ${i === 3 ? 'roster-id-k' : ''}`}>{m.id}</span>
                    <span className="roster-body">
                      <span className="roster-model">{m.model}</span>
                      <span className="roster-meta">{i === 3 ? 'final reviewer' : 'examiner'} · {m.provider} · {m.family}</span>
                    </span>
                    <span className={`dot ${m.keyPresent && m.approved ? 'dot-green' : 'dot-red'}`} title={m.keyPresent && m.approved ? 'Ready' : 'Not ready'} />
                  </li>
                ))}
              </ul>
            )}
            {config.data && config.data.problems.filter((p) => p.level === 'error').map((p, i) => (
              <div key={i} className="banner banner-red"><Icon name="alert" /><span>{p.message}</span></div>
            ))}
            {config.error && <ErrorBanner message={config.error} onRetry={config.reload} />}
            <Link to="/models" className="link-quiet">Examiner details <Icon name="arrow" size={13} /></Link>
          </Card>

          <Card title="What happens next">
            <ol className="steps">
              <li>Your files are locked so nothing can change. Nothing is edited.</li>
              <li>The computer counts what can be counted.</li>
              <li>Three AI examiners mark the rest; a fourth reviews.</li>
              <li>The result is decided by fixed rules, and you get a report with the steps to green.</li>
            </ol>
          </Card>

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!canSubmit}>
            {busy ? (<><span className="spinner spinner-sm" /> Starting…</>) : (<>Start the check <Icon name="arrow" /></>)}
          </button>
          {!ready && config.data && <p className="field-hint center">The AI examiners are not ready yet, so a check cannot start. See the red notes above.</p>}
        </aside>
      </form>
    </>
  );
}
