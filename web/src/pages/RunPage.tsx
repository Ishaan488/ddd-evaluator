import { Link, useParams } from 'react-router-dom';
import type { RunDetail } from '@ddd/shared';
import { api } from '../api';
import { Chip, DecisionChip } from '../components/Chip';
import { Icon } from '../components/Icons';
import { Card, ErrorBanner, Loading, PageHeader } from '../components/Layout';
import { Pipeline } from '../components/Pipeline';
import { formatDate } from '../format';
import { useDocumentTitle, useResource } from '../hooks';
import { ReportView } from './report/ReportView';

const isLive = (run: RunDetail) => run.status === 'queued' || run.status === 'running';

export function RunPage() {
  const { id = '' } = useParams();
  const run = useResource(() => api.run(id), [id], (r) => (isLive(r) ? 1500 : null));
  const r = run.data;
  useDocumentTitle(r ? `${r.projectName} v${r.iteration}` : 'Evaluation');

  if (run.loading) return <Loading label="Loading evaluation" />;
  if (run.error && !r) return <ErrorBanner message={run.error} onRetry={run.reload} />;
  if (!r) return null;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to={`/projects/${r.projectId}`} className="crumb">
            <Icon name="back" size={13} /> {r.projectName}
          </Link>
        }
        title={
          <span className="title-row">
            Iteration v{r.iteration}
            {r.status === 'done' && <DecisionChip decision={r.finalDecision} size="md" />}
            {isLive(r) && <Chip tone="accent">Running</Chip>}
            {r.status === 'failed' && <Chip tone="red">Failed</Chip>}
          </span>
        }
        actions={
          <>
            {r.status === 'done' && (
              <div className="btn-group">
                <a className="btn btn-secondary" href={api.reportUrl(r.id, 'xlsx')}><Icon name="download" /> Excel</a>
                <a className="btn btn-secondary" href={api.reportUrl(r.id, 'md')}>Markdown</a>
                <a className="btn btn-secondary" href={api.reportUrl(r.id, 'json')}>JSON</a>
              </div>
            )}
            <Link to={`/new?project=${encodeURIComponent(r.projectName)}`} className="btn btn-primary">
              <Icon name="refresh" /> {r.status === 'failed' ? 'Submit again' : 'Next iteration'}
            </Link>
          </>
        }
      >
        <span className="mono">{r.artifactName}</span> · {r.scorecardId} · {r.gate === 'D3' ? 'output document' : 'schema design'} · {formatDate(r.createdAt)}
      </PageHeader>

      {r.status === 'failed' && (
        <div className="banner banner-red" role="alert">
          <Icon name="alert" />
          <span><strong>This evaluation could not finish.</strong> {r.error}</span>
        </div>
      )}

      {r.status !== 'done' && (
        <Card title={isLive(r) ? 'Evaluating' : 'Where it stopped'} aside={isLive(r) ? <span className="faint">Updates live</span> : undefined}>
          <Pipeline run={r} />
        </Card>
      )}

      {r.status === 'done' && r.report && (
        <ReportView run={r} onChange={(next) => run.setData(next)} />
      )}
    </>
  );
}
