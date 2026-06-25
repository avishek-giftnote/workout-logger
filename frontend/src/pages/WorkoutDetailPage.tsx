import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import type { SetDto, WorkoutDto } from "../api/types";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

const workingVolume = (w: WorkoutDto) => {
  let v = 0;
  for (const b of w.exercises) for (const s of b.sets)
    if (s.setType === "WORKING" && s.weight && s.reps) v += parseFloat(s.weight) * s.reps;
  return Math.round(v);
};

function loadLabel(s: SetDto): string {
  if (s.loadMode === "BODYWEIGHT") return `${s.weight} kg · BW`;
  if (s.loadMode === "ADDED") return `${s.weight} kg · BW +${s.loadDelta}`;
  if (s.loadMode === "ASSISTED") return `${s.weight} kg · assist −${s.loadDelta}`;
  return `${s.weight ?? "—"} kg`;
}

export default function WorkoutDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const workout = useQuery({ queryKey: ["workout", id], queryFn: () => Api.getWorkout(id) });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const del = useMutation({
    mutationFn: () => Api.deleteWorkout(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workouts"] }); nav("/previous-workouts"); },
  });

  const title = useMemo(() => {
    const w = workout.data;
    if (!w) return "Workout";
    const t = (templates.data ?? []).find((x) => x.id === w.templateId);
    return (t?.name ?? w.exercises[0]?.name ?? "Workout").replace(/\s*focus/i, "");
  }, [workout.data, templates.data]);

  if (workout.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (workout.isError) return <QueryError onRetry={workout.refetch} />;
  if (!workout.data) return (
    <main className="screen">
      <div className="empty"><div className="big">Workout not found</div>
        <button className="btn btn-ghost mt" onClick={() => nav("/previous-workouts")}>← Back</button></div>
    </main>
  );

  const w = workout.data;
  const totalSets = w.exercises.reduce((n, b) => n + b.sets.length, 0);

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <button className="micro" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
            onClick={() => nav("/previous-workouts")}>← Training Log</button>
          <h1>{title}</h1>
          <p>{fmtDate(w.startedAt)}</p>
        </div>
        <div className="w-stat" style={{ textAlign: "right" }}>
          <b className="mono" style={{ color: "var(--volt)", fontSize: 22 }}>{workingVolume(w).toLocaleString()}</b>
          <small className="micro" style={{ display: "block" }}>kg volume</small>
        </div>
      </div>

      <p className="micro" style={{ margin: "0 4px 14px" }}>
        {w.exercises.length} exercises · {totalSets} sets{w.durationSeconds ? ` · ${Math.round(w.durationSeconds / 60)} min` : ""}
      </p>

      <div className="stagger">
        {w.exercises.map((b) => {
          let workingNo = 0;
          return (
            <section key={b.exerciseId + b.position} className="card ex-block">
              <div className="ex-head"><h3>{b.name}</h3></div>
              {b.note && <div className="block-note">“{b.note}”</div>}
              {b.sets.map((s, i) => {
                const warm = s.setType === "WARMUP";
                return (
                  <div key={i} className="detail-row">
                    <span className={`set-idx${warm ? " warm" : ""}`} style={{ cursor: "default" }}>
                      {warm ? "W" : String(++workingNo)}
                    </span>
                    <span className="readout grow">{loadLabel(s)}</span>
                    <span className="mono detail-reps">{s.reps ?? "—"} <span className="micro">reps</span></span>
                    <span className="mono detail-rpe">{s.rpe != null ? <>RPE {s.rpe}</> : <span className="micro">—</span>}</span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <div className="row mt" style={{ gap: 10 }}>
        <button className="btn btn-volt grow" onClick={() => nav(`/previous-workouts/${id}/edit`)}>Edit workout</button>
        <button className="btn btn-ghost btn-danger grow" onClick={() => setConfirmDelete(true)}>Delete</button>
      </div>
      <button className="btn btn-ghost btn-block mt" onClick={() => nav("/previous-workouts")}>← Back to Training Log</button>

      {confirmDelete && (
        <div className="popup-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Delete workout</span>
            <h3 style={{ fontSize: 20 }}>Delete this session?</h3>
            <p className="muted" style={{ fontSize: 13 }}>This removes the logged workout. It can't be undone here.</p>
            <button className="btn btn-ghost btn-block btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? "Deleting…" : "Delete workout"}
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        </div>
      )}
    </main>
  );
}
