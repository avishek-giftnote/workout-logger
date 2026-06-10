import { useId, useMemo, useState } from "react";

export interface Point { label: string; value: number; }   // label = ISO date

/** Minimal dependency-free SVG line chart with a gradient fill. Text labels live outside (see ChartCard). */
export function TrendChart({ points, color = "var(--volt)", height = 110 }: {
  points: Point[]; color?: string; height?: number;
}) {
  const gid = useId();
  if (points.length < 2) return <div className="chart-empty">Not enough data in this range</div>;

  const W = 320, H = height, pad = 8;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - 2 * pad);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none" style={{ width: "100%", height }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"
        strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.4 : 1.6}
          fill={color} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

const PERIODS: { key: string; label: string; days: number }[] = [
  { key: "W", label: "Week", days: 7 },
  { key: "M", label: "Month", days: 31 },
  { key: "A", label: "All", days: Infinity },
];
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtNum = (n: number) => n.toLocaleString();

/** Chart with a title, a Week/Month/All time-window toggle, and labelled x/y axes. */
export function ChartCard({ title, points, yLabel, xLabel = "Date", color = "var(--volt)", format = fmtNum }: {
  title: string; points: Point[]; yLabel: string; xLabel?: string; color?: string; format?: (n: number) => string;
}) {
  const [pk, setPk] = useState("A");
  const shown = useMemo(() => {
    const days = PERIODS.find((p) => p.key === pk)!.days;
    if (!isFinite(days) || points.length === 0) return points;
    const latest = new Date(points[points.length - 1].label).getTime();
    return points.filter((p) => (latest - new Date(p.label).getTime()) / 86_400_000 <= days);
  }, [points, pk]);

  const vals = shown.map((p) => p.value);
  const max = vals.length ? Math.max(...vals) : 0;
  const min = vals.length ? Math.min(...vals) : 0;

  return (
    <div className="card card-pad" style={{ marginBottom: 12 }}>
      <div className="chart-head">
        <span className="micro">{title}</span>
        <div className="seg chart-period">
          {PERIODS.map((p) => (
            <button key={p.key} className={pk === p.key ? "on" : ""} onClick={() => setPk(p.key)}>{p.label}</button>
          ))}
        </div>
      </div>
      <div className="chart-body">
        <div className="y-axis">
          <span>{shown.length >= 2 ? format(max) : ""}</span>
          <span className="y-title">{yLabel}</span>
          <span>{shown.length >= 2 ? format(min) : ""}</span>
        </div>
        <div className="plot-col">
          <div className="plot"><TrendChart points={shown} color={color} /></div>
          <div className="x-axis">
            <span>{shown.length >= 2 ? fmtDate(shown[0].label) : ""}</span>
            <span className="x-title">{xLabel}</span>
            <span>{shown.length >= 2 ? fmtDate(shown[shown.length - 1].label) : ""}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
