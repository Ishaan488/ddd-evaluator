import type { PathToGreen as Path } from '@ddd/shared';
import { DecisionChip } from '../../components/Chip';
import { Icon } from '../../components/Icons';

export function PathToGreen({ path }: { path: Path }) {
  return (
    <>
      {path.steps.length > 0 && (
        <ol className="path">
          {path.steps.map((s) => (
            <li key={s.dimensionId} className="path-step">
              <span className="path-n">{s.order}</span>
              <div className="path-body">
                <div className="path-title">
                  <span className="mono faint">{s.dimensionId}</span> {s.name}
                  {s.reason === 'critical gate' && <span className="crit" title="Unblocks a must-pass check">★</span>}
                </div>
                <div className="path-sub">
                  {s.reason === 'critical gate' ? 'Stops it being green: a must-pass check needs 4 or more.' : 'Adds the most points for the least effort.'}
                  {s.findingIds.length > 0 && <> Also fixes <span className="mono">{s.findingIds.join(', ')}</span>.</>}
                </div>
              </div>
              <span className="path-move mono">
                {s.from} <Icon name="arrow" size={13} /> {s.to}
              </span>
              <span className="path-gain mono up">+{s.scoreGain.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}

      {path.blockingFindingIds.length > 0 && (
        <div className="path-person path-block">
          <Icon name="flag" />
          <div>
            <strong>Fix these must-fix problems before you submit again</strong>
            <p className="path-block-ids">
              {path.blockingFindingIds.map((id) => (
                <a key={id} className="mono finding-link" href="#fix">{id}</a>
              ))}
            </p>
          </div>
        </div>
      )}

      {path.needsPerson.length > 0 && (
        <div className="path-person">
          <Icon name="user" />
          <div>
            <strong>A person also has to supply</strong>
            <ul>
              {path.needsPerson.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="path-result">
        <span>{path.note}</span>
        {(path.steps.length > 0 || path.blockingFindingIds.length > 0) && (
          <span className="path-outcome">
            Expected result <span className="mono">{path.resultingScore.toFixed(1)}</span> <DecisionChip decision={path.resultingDecision} size="sm" />
          </span>
        )}
      </div>
    </>
  );
}
