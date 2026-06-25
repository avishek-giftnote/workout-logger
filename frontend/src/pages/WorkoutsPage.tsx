import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useSettings } from "../settings";
import CoachCard from "../components/CoachCard";
import QueryError from "../components/QueryError";
import type { WorkoutDto } from "../api/types";

function workingVolume(w: WorkoutDto): number {
  let v = 0;
  for (const b of w.exercises)
    for (const s of b.sets)
      if (s.setType === "WORKING" && s.weight && s.reps) v += parseFloat(s.weight) * s.reps;
  return Math.round(v);
}
const workingSets = (w: WorkoutDto) =>
  w.exercises.reduce((n, b) => n + b.sets.filter((s) => s.setType === "WORKING").length, 0);

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const VIEW_KEY = "wl.logView";

export default function WorkoutsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { coachEnabled } = useSettings();
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const [view, setView] = useState<"list" | "calendar">(() => (localStorage.getItem(VIEW_KEY) as "list" | "calendar") || "calendar");
  const setMode = (v: "list" | "calendar") => { localStorage.setItem(VIEW_KEY, v); setView(v); };
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null);
  const [picker, setPicker] = useState<WorkoutDto[] | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => Api.deleteWorkout(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workouts"] }); setDeleteId(null); },
  });

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

  const initial = useMemo(() => {
    const d = workouts.data?.[0] ? new Date(workouts.data[0].startedAt) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  }, [workouts.data]);
  const cur = month ?? initial;
  const moveMonth = (delta: number) => { const d = new Date(cur.y, cur.m + delta, 1); setMonth({ y: d.getFullYear(), m: d.getMonth() }); };

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

  if (workouts.isError) return <QueryError onRetry={workouts.refetch} />;

  const empty = workouts.data && workouts.data.length === 0;

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Training Log</h1>
          <p>{view === "calendar" && monthCount ? `${monthCount} session${monthCount === 1 ? "" : "s"} this month` : "Log every set. Beat last time."}</p>
        </div>
        <button className="btn btn-volt" onClick={() => nav("/start")}>+ New</button>
      </div>

      {coachEnabled && <CoachCard />}

      {!empty && (
        <div className="seg fade-up" style={{ marginBottom: 16 }}>
          <button className={view === "list" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("list")}>List</button>
          <button className={view === "calendar" ? "on" : ""} style={{ flex: 1 }} onClick={() => setMode("calendar")}>Calendar</button>
        </div>
      )}

      {workouts.isLoading && <div className="spinner" />}

      {empty && (
        <div className="empty fade-up">
          <div className="big">No sessions yet</div>
          <p>Your logged workouts will appear here.</p>
          <button className="btn btn-volt mt" onClick={() => nav("/start")}>Start your first workout</button>
        </div>
      )}

      {!empty && view === "calendar" && workouts.data && (
        <div className="card card-pad fade-up">
          <div className="cal-head">
            <button className="icon-btn" onClick={() => moveMonth(-1)} title="Previous month">‹</button>
            <b>{MONTHS[cur.m]} {cur.y}</b>
            <button className="icon-btn" onClick={() => moveMonth(1)} title="Next month">›</button>
          </div>
          <div className="cal-grid">
            {DOW.map((d, i) => <span key={`wd${i}`} className="cal-wd">{d}</span>)}
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

      {!empty && view === "list" && (
        <div className="w-list stagger">
          {workouts.data?.map((w) => {
            const d = new Date(w.startedAt);
            return (
              <div key={w.id} className="card w-item" style={{ cursor: "pointer" }}
                onClick={() => nav(`/previous-workouts/${w.id}`)}>
                <div className="w-date">
                  <span className="d">{d.getDate()}</span>
                  <span className="m">{MON[d.getMonth()]}</span>
                </div>
                <div className="w-meta">
                  <h3>{nameOf(w)}</h3>
                  <div className="sub">
                    {w.exercises.length} exercises · {workingSets(w)} sets
                    {w.durationSeconds ? ` · ${Math.round(w.durationSeconds / 60)} min` : ""}
                  </div>
                </div>
                <div className="w-stat">
                  <b>{workingVolume(w).toLocaleString()}</b>
                  <small>kg volume</small>
                </div>
                <button className="icon-btn w-del" title="Delete workout"
                  onClick={(e) => { e.stopPropagation(); setDeleteId(w.id); }}>×</button>
              </div>
            );
          })}
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

      {deleteId && (
        <div className="popup-backdrop" onClick={() => setDeleteId(null)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Delete workout</span>
            <h3 style={{ fontSize: 20 }}>Delete this session?</h3>
            <p className="muted" style={{ fontSize: 13 }}>This removes the logged workout. It can't be undone here.</p>
            <button className="btn btn-ghost btn-block btn-danger" disabled={del.isPending}
              onClick={() => del.mutate(deleteId)}>{del.isPending ? "Deleting…" : "Delete workout"}</button>
            <button className="btn btn-ghost btn-block" onClick={() => setDeleteId(null)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
