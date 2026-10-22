import { useState } from 'react';
import type { Decision, DimensionTrendRow, TrendPoint } from '@ddd/shared';

const TONE: Record<Decision, string> = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

/** The weighted score as a ring, coloured by the decision. */
export function ScoreRing({ score, decision, size = 148 }: { score: number; decision: Decision; size?: number }) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`Score ${score} out of 100, ${decision}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE[decision]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-arc"
        />
      </svg>
      <div className="ring-text">
        <span className="ring-score">{score.toFixed(1)}</span>
        <span className="ring-of">of 100</span>
      </div>
    </div>
  );
}

/** A 0-100 track with the refine and accept thresholds marked and the score on it. */
export function ThresholdBar({ score, refine, accept, decision }: { score: number; refine: number; accept: number; decision: Decision }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  return (
    <div className="threshold" aria-hidden="true">
      <div className="threshold-track">
        <span className="threshold-zone zone-red" style={{ width: at(refine) }} />
        <span className="threshold-zone zone-amber" style={{ left: at(refine), width: at(accept - refine) }} />
        <span className="threshold-zone zone-green" style={{ left: at(accept), width: at(100 - accept) }} />
        <span className="threshold-marker" style={{ left: at(score), background: TONE[decision] }} />
      </div>
      <div className="threshold-labels">
        <span style={{ left: '0%' }}>0</span>
        <span style={{ left: at(refine) }}>{refine}</span>
        <span style={{ left: at(accept) }}>{accept}</span>
        <span style={{ left: '100%' }}>100</span>
      </div>
    </div>
  );
}

/** A tiny trend line for the project list. */
export function Sparkline({ values, width = 96, height = 28 }: { values: Array<number | null>; width?: number; height?: number }) {
  const points = values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  if (points.length === 0) return <span className="faint">—</span>;
  // Zoom to the data so a climb from 78 to 88 is visible, but never zoom so far that noise looks dramatic.
  const lo = Math.max(0, Math.min(...points.map((p) => p.v)) - 8);
  const hi = Math.min(100, Math.max(...points.map((p) => p.v), 90) + 4);
  const x = (i: number) => (values.length === 1 ? width / 2 : 3 + (i / (values.length - 1)) * (width - 6));
  const y = (v: number) => height - 3 - ((v - lo) / (hi - lo || 1)) * (height - 6);
  const d = points.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="spark">
      {90 > lo && 90 < hi && <line x1="0" x2={width} y1={y(90)} y2={y(90)} className="spark-guide" />}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="2.6" fill="var(--accent)" />
    </svg>
  );
}

/** Score per iteration, with the amber and green zones shaded. */
export function TrendChart({ points, refine, accept }: { points: TrendPoint[]; refine: number; accept: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const height = 280;
  const pad = { l: 40, r: 20, t: 16, b: 34 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  // Start the axis a little under the lowest score or the refine line, so the useful range fills the chart.
  const lowest = Math.min(refine, ...points.flatMap((p) => (p.score === null ? [] : [p.score])));
  const floor = Math.max(0, Math.floor((lowest - 8) / 10) * 10);
  const y = (v: number) => pad.t + innerH - ((v - floor) / (100 - floor)) * innerH;
  const x = (i: number) => pad.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const scored = points.flatMap((p, i) => (p.score === null ? [] : [{ ...p, i, score: p.score }]));
  const path = scored.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const active = hover === null ? null : scored.find((p) => p.i === hover) ?? null;

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Score per iteration">
        <rect x={pad.l} y={y(100)} width={innerW} height={y(accept) - y(100)} className="band-green" />
        <rect x={pad.l} y={y(accept)} width={innerW} height={y(refine) - y(accept)} className="band-amber" />
        <rect x={pad.l} y={y(refine)} width={innerW} height={y(floor) - y(refine)} className="band-red" />
        {[...new Set([floor, refine, accept, 100, ...[25, 50].filter((t) => t > floor + 6 && t < refine - 6)])].map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y(tick)} y2={y(tick)} className={tick === refine || tick === accept ? 'grid-key' : 'grid'} />
            <text x={pad.l - 8} y={y(tick) + 4} textAnchor="end" className="axis">{tick}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.runId} x={x(i)} y={height - 10} textAnchor="middle" className="axis">v{p.iteration}</text>
        ))}
        {path && <path d={path} fill="none" stroke="var(--text-2)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />}
        {scored.map((p) => (
          <g key={p.runId} onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(p.i)} cy={y(p.score)} r={14} fill="transparent" />
            <circle cx={x(p.i)} cy={y(p.score)} r={hover === p.i ? 7 : 5} fill={p.decision ? TONE[p.decision] : 'var(--muted)'} stroke="var(--bg)" strokeWidth="2" />
          </g>
        ))}
        {active && (
          <g transform={`translate(${Math.min(Math.max(x(active.i) - 62, pad.l), width - pad.r - 124)} ${Math.max(y(active.score) - 52, 2)})`}>
            <rect width="124" height="40" rx="8" className="tip" />
            <text x="10" y="17" className="tip-title">v{active.iteration} · {active.score.toFixed(1)}</text>
            <text x="10" y="32" className="tip-sub">{active.decision ?? 'no verdict'}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

function scoreClass(score: number | null): string {
  if (score === null) return 'heat-none';
  if (score >= 5) return 'heat-5';
  if (score >= 4) return 'heat-4';
  if (score >= 3) return 'heat-3';
  if (score >= 2) return 'heat-2';
  return 'heat-1';
}

/** Dimensions down the side, iterations across, one coloured cell per score. */
export function Heatmap({ rows, iterations }: { rows: DimensionTrendRow[]; iterations: number[] }) {
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th scope="col">Dimension</th>
            {iterations.map((n) => (
              <th key={n} scope="col" className="heat-col">v{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dimensionId}>
              <th scope="row">
                <span className="mono faint">{row.dimensionId}</span>
                <span className="heat-name">{row.name}</span>
                {row.critical && <span className="crit" title="Critical gate">★</span>}
              </th>
              {row.scores.map((s, i) => (
                <td key={i}>
                  <span className={`heat ${scoreClass(s)}`} title={s === null ? 'not scored' : `score ${s}`}>{s === null ? '·' : s}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
