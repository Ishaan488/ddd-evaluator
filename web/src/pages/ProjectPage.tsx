import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Chip, DecisionChip } from '../components/Chip';
import { Heatmap, TrendChart } from '../components/Charts';
import { Icon } from '../components/Icons';
import { Card, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/Layout';
import { formatDate, formatScore } from '../format';
import { useDocumentTitle, useResource } from '../hooks';

export function ProjectPage() {
  const { id = '' } = useParams();
  const history = useResource(() => api.project(id), [id], (h) => (h.runs.some((r) => r.status === 'queued' || r.status === 'running') ? 2000 : null));
  const h = history.data;
  useDocumentTitle(h?.project.name ?? 'Project');

  if (history.loading) return <Loading />;
  if (history.error || !h) return <ErrorBanner message={history.error ?? 'Project not found.'} onRetry={history.reload} />;

  const done = h.runs.filter((r) => r.status === 'done');
  const latest = done[done.length - 1];
  const previous = done[done.length - 2];
  const delta = latest && previous && latest.weightedScore !== null && previous.weightedScore !== null ? latest.weightedScore - previous.weightedScore : null;
  const diffByRun = new Map(h.findingDiffs.map((d) => [d.runId, d]));
  const accept = h.thresholds?.accept ?? 90;
  const refine = h.thresholds?.refine ?? 75;

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/" className="crumb"><Icon name="back" size={13} /> Projects</Link>}
        title={h.project.name}
        actions={
          <Link to={`/new?project=${encodeURIComponent(h.project.name)}`} className="btn btn-primary">
            <Icon name="plus" /> New iteration
          </Link>
        }
      >
        {h.project.step ? `Step ${h.project.step} · ` : ''}
        {h.runs.length} iteration{h.runs.length === 1 ? '' : 's'}
      </PageHeader>

      {latest && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Latest verdict</span>
            <span className="stat-value"><DecisionChip decision={latest.finalDecision} size="lg" /></span>
            <span className="stat-hint">iteration v{latest.iteration}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Score</span>
            <span className="stat-value mono">{formatScore(latest.weightedScore)}</span>
            <span className="stat-hint">
              {delta === null ? `green at ${accept}` : (
                <span className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} since v{previous!.iteration}</span>
              )}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">Open findings</span>
            <span className="stat-value">{h.findingDiffs[h.findingDiffs.length - 1] ? h.findingDiffs[h.findingDiffs.length - 1]!.stillOpen + h.findingDiffs[h.findingDiffs.length - 1]!.added : 0}</span>
            <span className="stat-hint">in the latest iteration</span>
          </div>
          <div className="stat">
            <span className="stat-label">Fixed so far</span>
            <span className="stat-value">{h.findingDiffs.reduce((n, d) => n + d.fixed, 0)}</span>
            <span className="stat-hint">across all iterations</span>
          </div>
        </div>
      )}

      {h.trend.length > 0 ? (
        <Card title="Score per iteration" aside={<span className="faint">Green ≥ {accept} · amber ≥ {refine}</span>}>
          <TrendChart points={h.trend} refine={refine} accept={accept} />
        </Card>
      ) : (
        <Card>
          <EmptyState icon="chart" title="No finished iteration yet">The trend appears once an evaluation completes.</EmptyState>
        </Card>
      )}

      <Card title="Iterations" flush>
        <table className="table table-hover">
          <thead>
            <tr>
              <th>Version</th>
              <th>When</th>
              <th>Artifact</th>
              <th>Verdict</th>
              <th className="num">Score</th>
              <th className="num">Fixed</th>
              <th className="num">Still open</th>
              <th className="num">New</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...h.runs].reverse().map((r) => {
              const diff = diffByRun.get(r.id);
              return (
                <tr key={r.id}>
                  <td><Link to={`/runs/${r.id}`} className="row-title">v{r.iteration}</Link></td>
                  <td className="faint">{formatDate(r.createdAt)}</td>
                  <td className="mono faint truncate">{r.artifactName}</td>
                  <td>
                    {r.status === 'failed' ? <Chip tone="red">Failed</Chip> : r.status !== 'done' ? <Chip tone="accent">Running</Chip> : <DecisionChip decision={r.finalDecision} size="sm" />}
                  </td>
                  <td className="num mono">{formatScore(r.weightedScore)}</td>
                  <td className="num">{diff ? <span className={diff.fixed > 0 ? 'up' : 'faint'}>{diff.fixed}</span> : '—'}</td>
                  <td className="num">{diff ? diff.stillOpen : '—'}</td>
                  <td className="num">{diff ? <span className={diff.added > 0 ? 'down' : 'faint'}>{diff.added}</span> : '—'}</td>
                  <td className="num"><Link to={`/runs/${r.id}`} className="link-quiet">Open <Icon name="arrow" size={13} /></Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {h.dimensions.length > 0 && (
        <Card title="Dimension scores by iteration" aside={<span className="faint">★ critical gate, needs 4 or more</span>}>
          <Heatmap rows={h.dimensions} iterations={done.map((r) => r.iteration)} />
          <div className="legend">
            <span><i className="heat heat-5" /> 5</span>
            <span><i className="heat heat-4" /> 4</span>
            <span><i className="heat heat-3" /> 3</span>
            <span><i className="heat heat-2" /> 2</span>
            <span><i className="heat heat-1" /> 0–1</span>
          </div>
        </Card>
      )}
    </>
  );
}
