import type { Report } from '@ddd/shared';
import { Chip } from '../../components/Chip';

const LABEL = {
  agreement: 'Agreed',
  claims_checked: 'Claims checked',
  lower_stands: 'Lower stands',
  single_rater: 'One rater',
  code: 'Code',
  none: '—',
} as const;

export function AgreementTable({ report }: { report: Report }) {
  const raters = report.header.raters;
  if (report.agreement.length === 0) {
    return <p className="muted pad">This scorecard has no rater dimensions, so there is nothing for raters to agree on.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Dimension</th>
            {raters.map((r) => (
              <th key={r.id} className="num" title={`${r.provider}/${r.model}`}>{r.id}</th>
            ))}
            <th className="num">Spread</th>
            <th>Resolution</th>
            <th>What happened</th>
          </tr>
        </thead>
        <tbody>
          {report.agreement.map((a) => (
            <tr key={a.dimensionId}>
              <td><span className="mono faint">{a.dimensionId}</span> {a.name}</td>
              {raters.map((r) => (
                <td key={r.id} className="num mono">{a.scores[r.id] ?? '—'}</td>
              ))}
              <td className="num mono"><span className={a.spread !== null && a.spread > 1 ? 'down' : ''}>{a.spread ?? '—'}</span></td>
              <td>
                <Chip tone={a.flagged ? 'amber' : a.resolution === 'agreement' ? 'green' : 'muted'}>{LABEL[a.resolution]}</Chip>
              </td>
              <td className="muted">{a.note}{a.flagged && <strong className="flagged"> Flagged for a person.</strong>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
