import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import { LANDMARKS, MUSCLES, STATUS_COLOR, STATUS_LABEL, statusOf, weeklyMuscleSets } from "../muscles";

const DAY = 86_400_000;
const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const round = (n: number) => Math.round(n * 2) / 2;   // nearest 0.5

export default function MuscleVolumePage() {
  const nav = useNavigate();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const [offset, setOffset] = useState(0);   // 0 = most recent 7-day window

  const contribsOf = useMemo(() => {
    const m = new Map((exercises.data ?? []).map((e) => [e.id, e.muscleContributions]));
    return (id: string) => m.get(id);
  }, [exercises.data]);

  // anchor weeks to the most recent session so historical data shows
  const anchorEnd = useMemo(() => {
    const latest = workouts.data?.[0] ? new Date(workouts.data[0].startedAt) : new Date();
    latest.setHours(23, 59, 59, 999);
    return latest.getTime() + 1;
  }, [workouts.data]);
  const weekEnd = anchorEnd - offset * 7 * DAY;
  const weekStart = weekEnd - 7 * DAY;

  const tally = useMemo(
    () => weeklyMuscleSets(workouts.data ?? [], contribsOf, weekStart, weekEnd),
    [workouts.data, contribsOf, weekStart, weekEnd]);

  const counts = MUSCLES.reduce((a, { key }) => {
    const s = statusOf(round(tally[key] ?? 0), LANDMARKS[key]);
    a[s] = (a[s] ?? 0) + 1; return a;
  }, {} as Record<string, number>);

  if (exercises.isLoading || workouts.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (exercises.isError || workouts.isError) return <QueryError onRetry={() => { exercises.refetch(); workouts.refetch(); }} />;

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Weekly volume</h1>
          <p>Hard sets per muscle vs MEV–MAV–MRV landmarks</p>
        </div>
        <button className="btn btn-ghost" onClick={() => nav("/exercise-list")}>Exercises</button>
      </div>

      <div className="card card-pad fade-up" style={{ marginBottom: 16 }}>
        <div className="cal-head">
          <button className="icon-btn" onClick={() => setOffset((o) => o + 1)} title="Earlier week">‹</button>
          <b>{fmt(weekStart)} – {fmt(weekEnd - DAY)}</b>
          <button className="icon-btn" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))} title="Later week">›</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0", textAlign: "center" }}>
          {counts.productive ?? 0} productive · {counts.low ?? 0} below MEV · {(counts.high ?? 0) + (counts.over ?? 0)} high
        </p>
      </div>

      <div className="card">
        {MUSCLES.map(({ key, label }, i) => {
          const sets = round(tally[key] ?? 0);
          const lm = LANDMARKS[key];
          const status = statusOf(sets, lm);
          const scale = lm.mrv * 1.12 || 10;
          const pct = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
          return (
            <div key={key} className="mvol-row" style={{ borderTop: i ? "1px solid var(--line)" : "none" }}>
              <span className="mvol-label">{label}</span>
              <div className="mvol-bar" title={`${sets} sets · ${STATUS_LABEL[status]} (MEV ${lm.mev} · MAV ${lm.mav[0]}–${lm.mav[1]} · MRV ${lm.mrv})`}>
                <div className="mvol-zone" style={{ left: pct(lm.mev), width: `calc(${pct(lm.mav[1])} - ${pct(lm.mev)})` }} />
                <i className="mvol-tick" style={{ left: pct(lm.mrv) }} />
                <div className="mvol-fill" style={{ width: pct(sets), background: STATUS_COLOR[status] }} />
              </div>
              <span className="mvol-sets mono" style={{ color: STATUS_COLOR[status] }}>{sets}</span>
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ fontSize: 12, margin: "14px 4px 0" }}>
        Shaded band = MEV→MAV (productive). Tick = MRV (recoverable ceiling). Sets are credited per muscle from
        each exercise's map — edit an exercise's muscles on its page.
      </p>
    </main>
  );
}
