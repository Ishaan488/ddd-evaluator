import { Fragment, useState } from 'react';
import type { DimensionResult, Report } from '@ddd/shared';
import { ByChip, CellChip, Chip } from '../../components/Chip';

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="faint">—</span>;
  return (
    <span className="scorebar" title={`${score} of 5`}>
      <span className="scorebar-segs">
        {[1, 2, 3, 4, 5].map((n) => (
          <i key={n} className={n <= score ? `seg seg-on seg-${score >= 4 ? 'hi' : score >= 3 ? 'mid' : 'lo'}` : 'seg'} />
        ))}
      </span>
      <span className="mono">{score}</span>
    </span>
  );
}

function StatusCell({ dim }: { dim: DimensionResult }) {
  if (dim.status === 'unscored') return <Chip tone="red">Unscored</Chip>;
  if (dim.status === 'not_measurable') return <Chip tone="amber">Needs a person</Chip>;
  if (dim.flagged) return <Chip tone="amber">Flagged</Chip>;
  return <span className="faint">{dim.measuredBy === 'code' ? 'Counted' : 'Reconciled'}</span>;
}

export function ScoresTable({ report }: { report: Report }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const raterIds = report.header.raters.map((r) => r.id);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="table-scroll">
      <table className="table scores">
        <thead>
          <tr>
            <th>Dimension</th>
            <th className="num">Weight</th>
            {raterIds.map((id) => (
              <th key={id} className="num" title={report.header.raters.find((r) => r.id === id)?.model}>{id}</th>
            ))}
            <th>Score</th>
            <th className="num">Spread</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {report.dimensions.map((d) => {
            const expanded = open.has(d.id);
            const detail = d.rationale || d.evidence.length > 0 || d.codeDetail;
            return (
              <Fragment key={d.id}>
                <tr className={`${detail ? 'clickable' : ''} ${expanded ? 'row-open' : ''}`} onClick={() => detail && toggle(d.id)}>
                  <td>
                    <div className="dim">
                      <span className="mono faint dim-id">{d.id}</span>
                      <span className="dim-main">
                        <span className="dim-name">{d.name}</span>
                        {d.critical && <span className="crit" title="Critical gate: needs 4 or more">★</span>}
                        <ByChip by={d.measuredBy} />
                      </span>
                    </div>
                  </td>
                  <td className="num faint">{d.weight}</td>
                  {raterIds.map((id) => (
                    <td key={id} className="num mono">{d.measuredBy === 'raters' ? (d.raterScores[id] ?? '—') : <span className="faint">·</span>}</td>
                  ))}
                  <td><ScoreBar score={d.consolidated} /></td>
                  <td className="num mono">{d.spread === null ? <span className="faint">—</span> : d.spread}</td>
                  <td><StatusCell dim={d} /></td>
                </tr>
                {expanded && (
                  <tr className="row-detail">
                    <td colSpan={raterIds.length + 5}>
                      <div className="detail">
                        {d.codeDetail && <p><strong>Counted:</strong> {d.codeDetail.summary}.</p>}
                        {d.rationale && <p>{d.rationale}</p>}
                        {d.error && <p className="down">{d.error}</p>}
                        {d.evidence.length > 0 && (
                          <p className="detail-evidence">
                            <span className="faint">Evidence</span>
                            {d.evidence.map((e, i) => (
                              <span key={i} className="evidence">
                                <CellChip sheet={e.sheet} cell={e.cell} />
                                {e.quote && <q>{e.quote}</q>}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
