import type { WorkoutDto } from "./api/types";
import { e1rm as est1rm } from "./prescription";

type Block = WorkoutDto["exercises"][number];

export interface ChartDef {
  key: string;
  label: string;
  cardio: boolean;
  yLabel: string;
  format?: (n: number) => string;
  /** Per-session value from one exercise block; null when there's no data that session. */
  value: (b: Block) => number | null;
}

/** Charts available on an exercise's page (one series each), gated by the user's Settings → Graphs. */
export const EXERCISE_CHARTS: ChartDef[] = [
  {
    key: "EST_1RM", label: "Est. 1RM", cardio: false, yLabel: "Est. 1RM (kg)",
    value: (b) => { let m = 0; for (const s of b.sets) if (s.setType === "WORKING" && s.weight) m = Math.max(m, est1rm(parseFloat(s.weight), s.reps ?? 1)); return m ? Math.round(m) : null; },
  },
  {
    key: "VOLUME", label: "Volume", cardio: false, yLabel: "Volume (kg)",
    value: (b) => { let v = 0; for (const s of b.sets) if (s.setType === "WORKING" && s.weight && s.reps) v += parseFloat(s.weight) * s.reps; return v ? Math.round(v) : null; },
  },
  {
    key: "TOP_SET", label: "Top set", cardio: false, yLabel: "Top set (kg)",
    value: (b) => { let m = 0; for (const s of b.sets) if (s.setType === "WORKING" && s.weight) m = Math.max(m, parseFloat(s.weight)); return m || null; },
  },
  {
    key: "REPS", label: "Total reps", cardio: false, yLabel: "Reps",
    value: (b) => { let r = 0; for (const s of b.sets) if (s.setType === "WORKING" && s.reps) r += s.reps; return r || null; },
  },
  {
    key: "DISTANCE", label: "Distance", cardio: true, yLabel: "Distance (km)",
    value: (b) => { let d = 0; for (const s of b.sets) if (s.distanceM) d += parseFloat(s.distanceM); return d ? +(d / 1000).toFixed(2) : null; },
  },
  {
    key: "DURATION", label: "Duration", cardio: true, yLabel: "Duration (min)",
    value: (b) => { let t = 0; for (const s of b.sets) if (s.durationS) t += s.durationS; return t ? Math.round(t / 60) : null; },
  },
  {
    key: "SPEED", label: "Speed", cardio: true, yLabel: "Speed (km/h)",
    value: (b) => { let d = 0, t = 0; for (const s of b.sets) { if (s.distanceM) d += parseFloat(s.distanceM); if (s.durationS) t += s.durationS; } return d && t ? +((d / 1000) / (t / 3600)).toFixed(1) : null; },
  },
];

/** Charts available on a template's page. */
export const TEMPLATE_CHARTS = [
  { key: "TEMPLATE_VOLUME", label: "Total volume", yLabel: "Volume (kg)" },
];

export const ALL_CHART_KEYS = [...EXERCISE_CHARTS.map((c) => c.key), ...TEMPLATE_CHARTS.map((c) => c.key)];
