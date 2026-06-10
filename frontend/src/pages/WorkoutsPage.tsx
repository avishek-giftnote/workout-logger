import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { TrendChart } from "../components/Chart";
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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export default function WorkoutsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const del = useMutation({
    mutationFn: (id: string) => Api.deleteWorkout(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workouts"] }); setDeleteId(null); },
  });

  const nameOf = useMemo(() => {
    const map = new Map((templates.data ?? []).map((t) => [t.id, t.name]));
    return (w: WorkoutDto) => (w.templateId && map.get(w.templateId)) || w.exercises[0]?.name || "Workout";
  }, [templates.data]);

  // working volume per session, oldest → newest (excludes warmups)
  const volPoints = useMemo(() =>
    [...(workouts.data ?? [])].reverse().map((w) => ({ label: w.startedAt, value: workingVolume(w) })),
    [workouts.data]);

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Training Log</h1>
          <p>Log every set. Beat last time.</p>
        </div>
        <button className="btn btn-volt" onClick={() => nav("/start")}>+ New</button>
      </div>

      {workouts.isLoading && <div className="spinner" />}

      {volPoints.length >= 2 && (
        <div className="card card-pad fade-up" style={{ marginBottom: 18 }}>
          <span className="micro">Working volume (kg) per session</span>
          <div className="mt"><TrendChart points={volPoints} color="var(--volt)" /></div>
        </div>
      )}

      {workouts.data && workouts.data.length === 0 && (
        <div className="empty fade-up">
          <div className="big">No sessions yet</div>
          <p>Your logged workouts will appear here.</p>
          <button className="btn btn-volt mt" onClick={() => nav("/start")}>Start your first workout</button>
        </div>
      )}

      <div className="w-list stagger">
        {workouts.data?.map((w) => {
          const d = new Date(w.startedAt);
          return (
            <div key={w.id} className="card w-item" style={{ cursor: "pointer" }}
              onClick={() => nav(`/previous-workouts/${w.id}`)}>
              <div className="w-date">
                <span className="d">{d.getDate()}</span>
                <span className="m">{MONTHS[d.getMonth()]}</span>
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
