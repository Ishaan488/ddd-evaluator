import type { RunDetail } from '@ddd/shared';
import { useState } from 'react';
import { Chip } from '../../components/Chip';
import { CopyButton } from '../../components/CopyButton';
import { formatDate, formatDuration, shortHash, splitNote } from '../../format';

export function RunDetails({ run }: { run: RunDetail }) {
  const { header } = run.report!;
  const log = run.runLog;
  const rows: Array<[string, string, string?]> = [
    ['Run ID', header.runId, 'mono'],
    ['Artifact', `${header.artifactName}`],
    ['File fingerprint', header.artifactHash, 'mono'],
    ['Scorecard', `${header.scorecardName} v${header.scorecardVersion}`],
    ['Scorecard fingerprint', header.scorecardHash, 'mono'],
    ['Scorecard approval', header.scorecardApproval ?? 'not stated'],
    ['Gate', header.gate === 'D1' ? 'D1 · schema design against its scorecard' : 'D3 · output document against its scorecard'],
    ['Instructions version', header.promptVersion, 'mono'],
    ...(header.instructions ? ([['Extra instructions', header.instructions], ['Instructions fingerprint', header.instructionsHash ?? '', 'mono']] as Array<[string, string, string?]>) : []),
    ['Started', formatDate(header.startedAt)],
    ['Finished', formatDate(header.finishedAt)],
  ];

  return (
    <>
      <dl className="kv">
        {rows.map(([k, v, cls]) => (
          <div key={k} className="kv-row">
            <dt>{k}</dt>
            <dd className={cls}>
              {v}
              {cls === 'mono' && v.length > 20 && <CopyButton value={v} />}
            </dd>
          </div>
        ))}
      </dl>

      {log && (
        <div className="table-scroll subtle">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Model</th>
                <th>Job</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th className="num">Tokens in / out</th>
                <th className="num">Time</th>
                <th className="num">Discarded</th>
                <th>Instructions fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {log.participants.map((p) => {
                const model = log.models.find((m) => m.id === p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="mono">{p.id}</span> {model?.provider}/{model?.model}
                      <div className="row-sub">{model?.family}</div>
                    </td>
                    <td className="faint">{p.role}</td>
                    <td>{p.status === 'ok' ? <Chip tone="green">Done</Chip> : <Chip tone="red">Failed</Chip>}{p.error && <div className="row-sub down">{p.error}</div>}</td>
                    <td className="num">{p.attempts}</td>
                    <td className="num mono">{p.inputTokens ?? '—'} / {p.outputTokens ?? '—'}</td>
                    <td className="num mono">{formatDuration(p.latencyMs)}</td>
                    <td className="num">{p.discarded}</td>
                    <td className="mono faint">{shortHash(log.promptHashes[p.id] ?? '')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {log && (
        <p className="note">
          Checked in {formatDuration(log.timings.checksMs)} · marked in {formatDuration(log.timings.ratingMs)} · reviewed in {formatDuration(log.timings.consolidationMs)} · {formatDuration(log.timings.totalMs)} in all.
          Temperature {log.settings.temperature}, node {log.nodeVersion}.
        </p>
      )}

      {run.report!.notes.length > 0 && (
        <div className="run-notes">
          <h3>Notes from this run</h3>
          <ul>
            {run.report!.notes.map((n, i) => (
              <Note key={i} text={n} />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Note({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const { summary, rest } = splitNote(text);
  return (
    <li>
      {more || !rest ? text : summary}
      {rest && (
        <button type="button" className="link-btn" onClick={() => setMore(!more)}>
          {more ? 'Show less' : 'Show full message'}
        </button>
      )}
    </li>
  );
}
