import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import type { WorkoutDto } from "../api/types";

function workingVolume(w: WorkoutDto): number {
  let v = 0;
  for (const b of w.exercises)
    for (const s of b.sets)
      if (s.setType === "WORKING" && s.weight && s.reps) v += parseFloat(s.weight) * s.reps;
  return Math.round(v);
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function WorkoutsPage() {
  const nav = useNavigate();
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const [view, setView] = useState<{ y: number; m: number } | null>(null);
  const [picker, setPicker] = useState<WorkoutDto[] | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map((templates.data ?? []).map((t) => [t.id, t.name]));
    return (w: WorkoutDto) => (w.templateId && map.get(w.templateId)) || w.exercises[0]?.name || "Workout";
  }, [templates.data]);

  const byDay = useMemo(() => {
    const m = new Map<string, WorkoutDto[]>();
    for (const w of workouts.data ?? []) {
      const k = dayKey(new Date(w.startedAt));
      (m.get(k) ?? m.set(k, []).get(k)!).push(w);
    }
    return m;
  }, [workouts.data]);

  // default to the most recent session's month (list is newest-first), else today
  const initial = useMemo(() => {
    const d = workouts.data?.[0] ? new Date(workouts.data[0].startedAt) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }, [workouts.data]);
  const cur = view ?? initial;
  const move = (delta: number) => { const d = new Date(cur.y, cur.m + delta, 1); setView({ y: d.getFullYear(), m: d.getMonth() }); };

  const startDow = new Date(cur.y, cur.m, 1).getDay();
  const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
  const today = new Date();
  const cells: (number | null)[] = [...Array(startDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthCount = cells.filter((d) => d && byDay.has(`${cur.y}-${cur.m}-${d}`)).length;

  const openDay = (day: number) => {
    const list = byDay.get(`${cur.y}-${cur.m}-${day}`) ?? [];
    if (list.length === 1) nav(`/previous-workouts/${list[0].id}`);
    else if (list.length > 1) setPicker(list);
  };

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Training Log</h1>
          <p>{monthCount ? `${monthCount} session${monthCount === 1 ? "" : "s"} this month` : "Log every set. Beat last time."}</p>
        </div>
        <button className="btn btn-volt" onClick={() => nav("/start")}>+ New</button>
      </div>

      {workouts.isLoading && <div className="spinner" />}

      {workouts.data && (
        <div className="card card-pad fade-up cal">
          <div className="cal-head">
            <button className="icon-btn" onClick={() => move(-1)} title="Previous month">‹</button>
            <b>{MONTHS[cur.m]} {cur.y}</b>
            <button className="icon-btn" onClick={() => move(1)} title="Next month">›</button>
          </div>
          <div className="cal-grid cal-dow">
            {DOW.map((d, i) => <span key={i} className="cal-wd">{d}</span>)}
          </div>
          <div className="cal-grid">
            {cells.map((day, i) => {
              if (!day) return <span key={i} className="cal-cell empty" />;
              const list = byDay.get(`${cur.y}-${cur.m}-${day}`);
              const isToday = today.getFullYear() === cur.y && today.getMonth() === cur.m && today.getDate() === day;
              return (
                <button key={i} className={`cal-cell${list ? " has" : ""}${isToday ? " today" : ""}`}
                  disabled={!list} onClick={() => openDay(day)}
                  title={list ? list.map(nameOf).join(", ") : undefined}>
                  <span className="n">{day}</span>
                  {list && <span className="dot">{list.length > 1 ? list.length : ""}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {workouts.data && workouts.data.length === 0 && (
        <div className="empty fade-up">
          <div className="big">No sessions yet</div>
          <p>Your logged workouts will appear on the calendar.</p>
          <button className="btn btn-volt mt" onClick={() => nav("/start")}>Start your first workout</button>
        </div>
      )}

      {picker && (
        <div className="popup-backdrop" onClick={() => setPicker(null)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">{new Date(picker[0].startedAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
            {picker.map((w) => (
              <button key={w.id} className="popup-opt" style={{ display: "flex", justifyContent: "space-between" }}
                onClick={() => nav(`/previous-workouts/${w.id}`)}>
                <span>{nameOf(w)}</span>
                <span className="mono" style={{ color: "var(--volt)" }}>{workingVolume(w).toLocaleString()} kg</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
