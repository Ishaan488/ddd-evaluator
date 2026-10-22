import { useMemo, useState } from 'react';
import { SEVERITY_ORDER, type Finding, type Severity } from '@ddd/shared';
import { CellChip, SeverityChip } from '../../components/Chip';
import { EmptyState } from '../../components/Layout';
import { SEVERITY, plural } from '../../copy';

export function FindingsList({ findings }: { findings: Finding[] }) {
  const [severity, setSeverity] = useState<Severity | 'ALL'>('ALL');
  const [dimension, setDimension] = useState('ALL');

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    findings.forEach((f) => (c[f.severity] += 1));
    return c;
  }, [findings]);
  const dimensions = useMemo(() => [...new Set(findings.map((f) => f.dimensionId))], [findings]);

  if (findings.length === 0) {
    return <EmptyState icon="check" title="Nothing to fix">No problems were found.</EmptyState>;
  }

  const shown = findings
    .filter((f) => (severity === 'ALL' || f.severity === severity) && (dimension === 'ALL' || f.dimensionId === dimension))
    .sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  return (
    <>
      <div className="filters">
        <div className="segmented" role="group" aria-label="Filter by severity">
          <button type="button" className={severity === 'ALL' ? 'on' : ''} onClick={() => setSeverity('ALL')}>All <span>{findings.length}</span></button>
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((s) => (
            <button key={s} type="button" className={severity === s ? 'on' : ''} onClick={() => setSeverity(s)} disabled={counts[s] === 0}>
              {SEVERITY[s].label} <span>{counts[s]}</span>
            </button>
          ))}
        </div>
        {dimensions.length > 1 && (
          <select className="input input-sm" value={dimension} onChange={(e) => setDimension(e.target.value)} aria-label="Filter by criterion">
            <option value="ALL">All criteria</option>
            {dimensions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
      </div>

      <ul className="findings">
        {shown.map((f) => (
          <li key={f.id} className={`finding finding-${f.severity.toLowerCase()}`}>
            <div className="finding-head">
              <span className="mono faint">{f.id}</span>
              <SeverityChip severity={f.severity} />
              {f.severity === 'HIGH' && <span className="blocks">Stops it being green</span>}
              <h3>{f.title}</h3>
              {f.location && <CellChip sheet={f.location.sheet} cell={f.location.cell} />}
            </div>
            {f.detail && <p className="finding-detail">{f.detail}</p>}
            <div className="finding-fix">
              <span className="finding-fix-label">How to fix</span>
              <span>{f.fix || 'No fix was suggested.'}</span>
            </div>
            <div className="finding-foot">
              <span>Criterion <span className="mono">{f.dimensionId}</span></span>
              <span>Send back to <strong>{f.returnTo}</strong></span>
              <span>{f.source === 'code' ? 'Found by the computer' : `Raised by ${plural(f.reportedBy.length, 'examiner')} (${f.reportedBy.join(', ')})`}</span>
            </div>
          </li>
        ))}
        {shown.length === 0 && <li className="muted">Nothing matches this filter.</li>}
      </ul>
    </>
  );
}
