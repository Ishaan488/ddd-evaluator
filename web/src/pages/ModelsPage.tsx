import type { ConfigResponse } from '@ddd/shared';
import { api } from '../api';
import { Chip } from '../components/Chip';
import { Icon } from '../components/Icons';
import { Card, ErrorBanner, Loading, PageHeader } from '../components/Layout';
import { useDocumentTitle, useResource } from '../hooks';

type Member = ConfigResponse['raters'][number];

function ModelCard({ member, role }: { member: Member; role: string }) {
  return (
    <div className={`model ${member.keyPresent && member.approved ? '' : 'model-warn'}`}>
      <div className="model-top">
        <span className="model-id">{member.id}</span>
        <span className="model-role">{role}</span>
      </div>
      <div className="model-name">{member.model}</div>
      <div className="model-meta">
        <span>{member.provider}</span>
        <span className="sep">·</span>
        <span>family: {member.family}</span>
      </div>
      <div className="model-chips">
        <Chip tone={member.keyPresent ? 'green' : 'red'}>{member.keyPresent ? 'API key set' : 'No API key'}</Chip>
        <Chip tone={member.approved ? 'green' : 'red'}>{member.approved ? 'Approved' : 'Not approved'}</Chip>
      </div>
    </div>
  );
}

const RULES = [
  ['Independence', 'The three raters come from three different model families, so blind spots are not shared. Roster is refused otherwise.'],
  ['Blind rating', 'Each rater sees only the scorecard, the artifact and the sources. Never another rater, never the author’s self-score.'],
  ['Evidence', 'Every score and finding must cite a cell that exists. A quote must really appear in that cell. Unsupported claims are discarded.'],
  ['Lower score stands', 'If raters differ by more than one point and the consolidator cannot resolve it from the artifact, the lower score is kept and a person is asked.'],
  ['Verdict by rule', 'Green, amber and red come from code applying the PDF’s decision rule. No model writes a verdict.'],
  ['Read only', 'The workbook is read, hashed before and after, and never written. The evaluator reports; the author fixes.'],
];

export function ModelsPage() {
  useDocumentTitle('Evaluator models');
  const config = useResource(api.config, []);
  const c = config.data;

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Evaluator models">
        The 3 + 1 roster used for every evaluation. Models and keys are set on the server, never in the browser.
      </PageHeader>

      {config.error && <ErrorBanner message={config.error} onRetry={config.reload} />}
      {config.loading && <Loading />}

      {c && (
        <>
          {c.problems.map((p, i) => (
            <div key={i} className={`banner banner-${p.level === 'error' ? 'red' : 'amber'}`} role={p.level === 'error' ? 'alert' : 'status'}>
              <Icon name="alert" />
              <span>{p.message}</span>
            </div>
          ))}
          {c.ready && c.problems.length === 0 && (
            <div className="banner banner-green">
              <Icon name="check" />
              <span>{c.mock ? 'Mock models are active: scripted answers, no live API calls. Good for a demo.' : 'Every model has a key and is approved. The roster is ready.'}</span>
            </div>
          )}

          <Card title="Three raters" aside={<span className="faint">Score independently · different families</span>}>
            <div className="models">
              {c.raters.map((m) => (
                <ModelCard key={m.id} member={m} role={`Rater ${m.id}`} />
              ))}
            </div>
          </Card>

          <Card title="One consolidator" aside={<span className="faint">Reconciles, does not re-rate</span>}>
            <div className="models models-one">
              <ModelCard member={c.consolidator} role="Consolidator" />
            </div>
          </Card>

          <Card title="How the roster is held to the PDF">
            <dl className="rules">
              {RULES.map(([term, body]) => (
                <div key={term} className="rule">
                  <dt>
                    <Icon name="shield" size={15} /> {term}
                  </dt>
                  <dd>{body}</dd>
                </div>
              ))}
            </dl>
            <p className="note">
              Prompt version <code>{c.promptVersion}</code>. To change a model, edit <code>server/config/models.json</code> and the keys in <code>.env</code>, then restart the server.
              Run <code>npm run models:check</code> to list what each provider offers.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
