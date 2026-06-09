import { useMemo } from "react";
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
const workingSets = (w: WorkoutDto) =>
  w.exercises.reduce((n, b) => n + b.sets.filter((s) => s.setType === "WORKING").length, 0);

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export default function WorkoutsPage() {
  const nav = useNavigate();
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });

  const nameOf = useMemo(() => {
    const map = new Map((templates.data ?? []).map((t) => [t.id, t.name]));
    return (w: WorkoutDto) => (w.templateId && map.get(w.templateId)) || w.exercises[0]?.name || "Workout";
  }, [templates.data]);

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Training Log</h1>
          <p>
            {me.data?.currentBodyweightKg
              ? <>Bodyweight <b className="mono" style={{ color: "var(--ice)" }}>{me.data.currentBodyweightKg} kg</b></>
              : "Log every set. Beat last time."}
          </p>
        </div>
        <button className="btn btn-volt" onClick={() => nav("/start")}>+ New</button>
      </div>

      {workouts.isLoading && <div className="spinner" />}

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
            <button key={w.id} className="card w-item" onClick={() => nav(`/previous-workouts/${w.id}`)}>
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
            </button>
          );
        })}
      </div>
    </main>
  );
}
