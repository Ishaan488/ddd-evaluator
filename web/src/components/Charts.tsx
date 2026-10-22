import { useEffect, useState } from 'react';
import type { Decision, DimensionTrendRow, TrendPoint } from '@ddd/shared';

const TONE: Record<Decision, string> = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** True shortly after mounting, so a CSS transition has a starting point to animate from. */
function useMounted(): boolean {
  const [on, setOn] = useState(reducedMotion());
  useEffect(() => {
    if (on) return;
    const timer = setTimeout(() => setOn(true), 40);
    return () => clearTimeout(timer);
  }, [on]);
  return on;
}

/** Counts a number up to its target, easing out, and lands exactly on the target. */
function useCountUp(target: number, ms = 1000): number {
  const [value, setValue] = useState(reducedMotion() ? target : 0);
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    const step = 20;
    const steps = Math.max(1, Math.round(ms / step));
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setValue(i >= steps ? target : target * (1 - Math.pow(1 - i / steps, 3)));
      if (i >= steps) clearInterval(timer);
    }, step);
    return () => clearInterval(timer);
  }, [target, ms]);
  return value;
}

/** The weighted score as a ring, coloured by the decision. It draws itself in and counts up. */
export function ScoreRing({ score, decision, size = 148 }: { score: number; decision: Decision; size?: number }) {
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const mounted = useMounted();
  const shown = useCountUp(score);
  const filled = mounted ? (Math.max(0, Math.min(100, score)) / 100) * circumference : 0;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`Score ${score} out of 100, ${decision}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <filter id="score-ring-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255, 255, 255, 0.06)" strokeWidth={stroke} />
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
          filter="url(#score-ring-glow)"
        />
      </svg>
      <div className="ring-text">
        <span className="ring-score">{shown.toFixed(1)}</span>
        <span className="ring-of">of 100</span>
      </div>
    </div>
  );
}

/** A 0-100 track with the refine and accept thresholds marked and the score on it. */
export function ThresholdBar({ score, refine, accept, decision }: { score: number; refine: number; accept: number; decision: Decision }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  const mounted = useMounted();
  return (
    <div className="threshold" aria-hidden="true">
      <div className="threshold-track">
        <span className="threshold-zone zone-red" style={{ width: at(refine) }} />
        <span className="threshold-zone zone-amber" style={{ left: at(refine), width: at(accept - refine) }} />
        <span className="threshold-zone zone-green" style={{ left: at(accept), width: at(100 - accept) }} />
        <span className="threshold-marker" style={{ left: mounted ? at(score) : '0%', background: TONE[decision], color: TONE[decision] }} />
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

/** A tiny trend line for the project list with luminous telemetry glow and area gradient. */
export function Sparkline({ values, width = 104, height = 32 }: { values: Array<number | null>; width?: number; height?: number }) {
  const points = values.flatMap((v, i) => (v === null ? [] : [{ i, v }]));
  if (points.length === 0) return <span className="faint">—</span>;
  // Zoom to the data so a climb from 78 to 88 is visible, but never zoom so far that noise looks dramatic.
  const lo = Math.max(0, Math.min(...points.map((p) => p.v)) - 8);
  const hi = Math.min(100, Math.max(...points.map((p) => p.v), 90) + 4);
  const x = (i: number) => (values.length === 1 ? width / 2 : 4 + (i / (values.length - 1)) * (width - 8));
  const y = (v: number) => height - 4 - ((v - lo) / (hi - lo || 1)) * (height - 8);
  const d = points.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const area = `${d} L${x(last.i).toFixed(1)} ${height} L${x(first.i).toFixed(1)} ${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="spark">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      {90 > lo && 90 < hi && <line x1="0" x2={width} y1={y(90)} y2={y(90)} className="spark-guide" />}
      {points.length > 1 && <path d={area} fill="url(#spark-fill)" />}
      <path d={d} fill="none" stroke="var(--accent-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r="3" fill="var(--accent-strong)" />
    </svg>
  );
}

/** Score per iteration, with the amber and green zones shaded. */
export function TrendChart({ points, refine, accept }: { points: TrendPoint[]; refine: number; accept: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const height = 170;
  const pad = { l: 36, r: 16, t: 12, b: 28 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  // Start the axis a little under the lowest score or the refine line, so the useful range fills the chart.
  const lowest = Math.min(refine, ...points.flatMap((p) => (p.score === null ? [] : [p.score])));
  const floor = Math.max(0, Math.floor((lowest - 8) / 10) * 10);
  const y = (v: number) => pad.t + innerH - ((v - floor) / (100 - floor)) * innerH;
  const x = (i: number) => pad.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const scored = points.flatMap((p, i) => (p.score === null ? [] : [{ ...p, i, score: p.score }]));
  const path = scored.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const area = scored.length > 1
    ? `${path} L${x(scored[scored.length - 1]!.i)} ${pad.t + innerH} L${x(scored[0]!.i)} ${pad.t + innerH} Z`
    : '';
  const active = hover === null ? null : scored.find((p) => p.i === hover) ?? null;

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Score per iteration">
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
          </linearGradient>
          <filter id="trend-line-glow" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
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
        {area && <path d={area} fill="url(#trend-fill)" />}
        {path && <path d={path} fill="none" stroke="var(--accent-strong)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" filter="url(#trend-line-glow)" />}
        {scored.map((p) => (
          <g key={p.runId} onMouseEnter={() => setHover(p.i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <circle cx={x(p.i)} cy={y(p.score)} r={16} fill="transparent" />
            {hover === p.i && (
              <circle cx={x(p.i)} cy={y(p.score)} r={11} fill="none" stroke={p.decision ? TONE[p.decision] : 'var(--accent)'} strokeWidth="1.5" opacity="0.6" />
            )}
            <circle cx={x(p.i)} cy={y(p.score)} r={hover === p.i ? 6.5 : 5} fill={p.decision ? TONE[p.decision] : 'var(--muted)'} stroke="var(--surface-solid)" strokeWidth="2.5" />
          </g>
        ))}
        {active && (
          <g transform={`translate(${Math.min(Math.max(x(active.i) - 62, pad.l), width - pad.r - 124)} ${Math.max(y(active.score) - 52, 2)})`}>
            <rect width="124" height="40" rx="10" className="tip" />
            <text x="12" y="17" className="tip-title">v{active.iteration} · {active.score.toFixed(1)}</text>
            <text x="12" y="32" className="tip-sub">{active.decision ?? 'no verdict'}</text>
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
