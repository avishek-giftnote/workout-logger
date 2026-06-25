import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import { ChartCard } from "../components/Chart";
import { useSettings } from "../settings";
import type { WorkoutDto } from "../api/types";

const workingVolume = (w: WorkoutDto) => {
  let v = 0;
  for (const b of w.exercises) for (const s of b.sets)
    if (s.setType === "WORKING" && s.weight && s.reps) v += parseFloat(s.weight) * s.reps;
  return Math.round(v);
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function TemplateDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { charts } = useSettings();
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });

  const tmpl = (templates.data ?? []).find((t) => t.id === id);
  const sessions = useMemo(
    () => (workouts.data ?? []).filter((w) => w.templateId === id),   // newest-first
    [workouts.data, id]);
  const points = useMemo(
    () => [...sessions].reverse().filter((w) => w.cyclePhase !== "DELOAD").map((w) => ({ label: w.startedAt, value: workingVolume(w) })),
    [sessions]);

  if (templates.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (templates.isError) return <QueryError onRetry={templates.refetch} />;
  if (!tmpl) return (
    <main className="screen">
      <div className="empty"><div className="big">Template not found</div>
        <button className="btn btn-ghost mt" onClick={() => nav("/start")}>← Start</button></div>
    </main>
  );

  const last = sessions[0];
  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <button className="micro" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
            onClick={() => nav("/start")}>← Start</button>
          <h1>{tmpl.name}</h1>
          <p>{tmpl.exercises.length} exercises · {sessions.length} session{sessions.length === 1 ? "" : "s"}{last ? ` · last ${fmtDate(last.startedAt)}` : ""}</p>
        </div>
      </div>

      {charts.includes("TEMPLATE_VOLUME")
        ? <ChartCard title="Total volume per workout" yLabel="Volume (kg)" points={points} color="var(--volt)" />
        : <p className="muted" style={{ fontSize: 13, margin: "0 4px 12px" }}>Template graph is off — enable it in Settings → Graphs.</p>}

      <p className="micro" style={{ margin: "18px 4px 10px" }}>Exercises</p>
      <div className="card">
        {tmpl.exercises.map((e, i) => (
          <button key={e.exerciseId + i} className="ex-row" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", borderTop: i ? "1px solid var(--line)" : "none" }}
            onClick={() => nav(`/exercise-list/${e.exerciseId}`)}>
            <span className="grow" style={{ textAlign: "left" }}>{e.name}</span>
            <span className="mono micro">{e.reps != null ? `${e.sets} × ${e.reps}${e.targetRir ? ` @ ${e.targetRir} RIR` : ""}` : `${e.sets} sets`}</span>
            <span className="readout" style={{ color: "var(--volt)" }}>›</span>
          </button>
        ))}
      </div>
    </main>
  );
}
