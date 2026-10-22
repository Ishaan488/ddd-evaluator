import { Link, useNavigate } from 'react-router-dom';
import type { ProjectSummary } from '@ddd/shared';
import { api } from '../api';
import { Chip, DecisionChip } from '../components/Chip';
import { Sparkline } from '../components/Charts';
import { Icon } from '../components/Icons';
import { Card, EmptyState, ErrorBanner, Loading, PageHeader } from '../components/Layout';
import { formatScore, timeAgo } from '../format';
import { useDocumentTitle, useResource } from '../hooks';

function Stat({ label, value, hint }: { label: string; value: number | string; hint: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}

function LatestChip({ project }: { project: ProjectSummary }) {
  const latest = project.latest;
  if (!latest) return <span className="faint">—</span>;
  if (latest.status === 'failed') return <Chip tone="red">Failed</Chip>;
  if (latest.status !== 'done') return <Chip tone="accent">In progress</Chip>;
  return <DecisionChip decision={latest.finalDecision} size="sm" />;
}

function HowItWorks() {
  const steps = [
    { n: '1', title: 'Bring the work and its scorecard', body: 'A schema workbook and the frozen scorecard that says how it is scored. People define both; the agent never edits them.' },
    { n: '2', title: 'Three raters, one consolidator', body: 'Counted checks run in code. Three blind models from different families score the judgement dimensions, and a fourth reconciles them.' },
    { n: '3', title: 'Fix, resubmit, watch it turn green', body: 'Every iteration is scored and kept. The report lists the path to green; a person fixes the file and runs it again.' },
  ];
  return (
    <div className="how">
      {steps.map((s) => (
        <div key={s.n} className="how-step">
          <span className="how-n">{s.n}</span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export function ProjectsPage() {
  useDocumentTitle('Projects');
  const navigate = useNavigate();
  const projects = useResource(api.projects, [], (list) => (list.some((p) => p.latest && p.latest.status !== 'done' && p.latest.status !== 'failed') ? 2000 : null));
  const list = projects.data ?? [];

  const evaluations = list.reduce((sum, p) => sum + p.runCount, 0);
  const green = list.filter((p) => p.latest?.finalDecision === 'green').length;
  const attention = list.filter((p) => p.latest?.finalDecision === 'amber' || p.latest?.finalDecision === 'red').length;

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Projects"
        actions={
          <Link to="/new" className="btn btn-primary">
            <Icon name="plus" /> New evaluation
          </Link>
        }
      >
        Each schema you evaluate is a project, and every submission is an iteration of it.
      </PageHeader>

      {projects.error && <ErrorBanner message={projects.error} onRetry={projects.reload} />}
      {projects.loading && <Loading label="Loading projects" />}

      {!projects.loading && !projects.error && list.length === 0 && (
        <Card>
          <EmptyState
            icon="chart"
            title="Nothing checked yet"
            action={
              <Link to="/new" className="btn btn-primary">
                <Icon name="plus" /> Evaluate your first schema
              </Link>
            }
          >
            Submit a schema workbook with its frozen scorecard to get a verdict and a path to green.
          </EmptyState>
          <HowItWorks />
        </Card>
      )}

      {list.length > 0 && (
        <>
          <div className="stats">
            <Stat label="Projects" value={list.length} hint="schemas being tracked" />
            <Stat label="Checks" value={evaluations} hint="rounds marked so far" />
            <Stat label="Green" value={green} hint="latest round passed" />
            <Stat label="Needs attention" value={attention} hint="still need a fix" />
          </div>

          <Card flush>
            <div className="table-scroll">
            <table className="table table-hover table-fit">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Latest result</th>
                  <th className="num">Score</th>
                  <th>Trend</th>
                  <th className="num">Rounds</th>
                  <th>Scorecard</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="clickable">
                    <td>
                      <Link to={`/projects/${p.id}`} className="row-title" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      {p.step && <div className="row-sub">Step {p.step}</div>}
                    </td>
                    <td>
                      <LatestChip project={p} />
                    </td>
                    <td className="num mono">{formatScore(p.latest?.weightedScore)}</td>
                    <td>
                      <Sparkline values={p.scores} />
                    </td>
                    <td className="num">{p.runCount}</td>
                    <td className="mono faint">{p.latest?.scorecardId ?? '—'}</td>
                    <td className="faint nowrap">{timeAgo(p.latest?.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
