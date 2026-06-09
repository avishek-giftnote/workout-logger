import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import { equipmentLabel } from "../logging/engine";
import type { SetDto, TemplateDto, WorkoutDto } from "../api/types";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function loadLabel(s: SetDto): string {
  if (s.loadMode === "BODYWEIGHT") return `${s.weight} kg · BW`;
  if (s.loadMode === "ADDED") return `${s.weight} kg · BW +${s.loadDelta}`;
  if (s.loadMode === "ASSISTED") return `${s.weight} kg · assist −${s.loadDelta}`;
  return `${s.weight ?? "—"} kg`;
}

export default function ExerciseDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });

  const ex = (exercises.data ?? []).find((e) => e.id === id);
  const tName = useMemo(() => {
    const m = new Map((templates.data ?? []).map((t: TemplateDto) => [t.id, t.name]));
    return (w: WorkoutDto) => (w.templateId && m.get(w.templateId)) || "Workout";
  }, [templates.data]);

  const history = useMemo(() => (workouts.data ?? [])
    .map((w) => ({ w, block: w.exercises.find((b) => b.exerciseId === id) }))
    .filter((x): x is { w: WorkoutDto; block: NonNullable<typeof x.block> } => !!x.block)
    .sort((a, b) => b.w.startedAt.localeCompare(a.w.startedAt)), [workouts.data, id]);

  const best = useMemo(() => {
    let top: { weight: number; reps: number | null } | null = null;
    for (const { block } of history)
      for (const s of block.sets)
        if (s.setType === "WORKING" && s.weight) {
          const wgt = parseFloat(s.weight);
          if (!top || wgt > top.weight) top = { weight: wgt, reps: s.reps };
        }
    return top;
  }, [history]);

  if (exercises.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (!ex) return (
    <main className="screen">
      <div className="empty"><div className="big">Exercise not found</div>
        <button className="btn btn-ghost mt" onClick={() => nav("/exercise-list")}>← Exercises</button></div>
    </main>
  );

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <button className="micro" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
            onClick={() => nav("/exercise-list")}>← Exercises</button>
          <h1>{ex.name}</h1>
          <p><span className="tag">{equipmentLabel(ex.equipment)}</span> · strength</p>
        </div>
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 18 }}>
        <div className="card card-pad grow" style={{ textAlign: "center" }}>
          <b className="mono" style={{ fontSize: 24, color: "var(--volt)" }}>{history.length}</b>
          <div className="micro mt">sessions</div>
        </div>
        <div className="card card-pad grow" style={{ textAlign: "center" }}>
          <b className="mono" style={{ fontSize: 24, color: "var(--ice)" }}>{best ? `${best.weight}` : "—"}</b>
          <div className="micro mt">top set kg{best?.reps ? ` ×${best.reps}` : ""}</div>
        </div>
      </div>

      <p className="micro" style={{ margin: "0 4px 10px" }}>History</p>
      {history.length === 0 && <div className="empty"><div className="big">No records yet</div><p>Log this exercise to see its history.</p></div>}

      <div className="stagger">
        {history.map(({ w, block }) => {
          let workingNo = 0;
          return (
            <section key={w.id} className="card ex-block">
              <button className="ex-head" style={{ width: "100%", background: "none", border: "none", cursor: "pointer" }}
                onClick={() => nav(`/previous-workouts/${w.id}`)}>
                <div>
                  <h3 style={{ fontSize: 16 }}>{fmtDate(w.startedAt)}</h3>
                  <div className="lasttime">{(tName(w) as string).replace(/\s*focus/i, "")}</div>
                </div>
                <span className="readout" style={{ color: "var(--volt)" }}>›</span>
              </button>
              {block.sets.map((s, i) => {
                const warm = s.setType === "WARMUP";
                return (
                  <div key={i} className="detail-row">
                    <span className={`set-idx${warm ? " warm" : ""}`} style={{ cursor: "default" }}>{warm ? "W" : String(++workingNo)}</span>
                    <span className="readout grow">{loadLabel(s)}</span>
                    <span className="mono detail-reps">{s.reps ?? "—"} <span className="micro">reps</span></span>
                    <span className="mono detail-rpe">{s.rpe != null ? `RPE ${s.rpe}` : "—"}</span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </main>
  );
}
