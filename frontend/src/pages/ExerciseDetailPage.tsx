import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { CARDIO_METRICS, REST_PRESETS, cardioMetricsOf, equipmentLabel, isCardioEx, paceSpeed } from "../logging/engine";
import { ChartCard, type Point } from "../components/Chart";
import type { CardioMetric, SetDto, TemplateDto, WorkoutDto } from "../api/types";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const est1rm = (weight: number, reps: number) => weight * (1 + reps / 30);   // Epley

function loadLabel(s: SetDto): string {
  if (s.kind === "CARDIO") {
    const parts: string[] = [];
    if (s.distanceM) parts.push(`${(parseFloat(s.distanceM) / 1000).toFixed(2)} km`);
    if (s.durationS != null) parts.push(fmtTime(s.durationS));
    if (s.distanceM && s.durationS) {
      const ps = paceSpeed(parseFloat(s.distanceM) / 1000, s.durationS);
      if (ps) parts.push(ps.pace);
    }
    return parts.join(" · ") || "—";
  }
  if (s.loadMode === "BODYWEIGHT") return `${s.weight} kg · BW`;
  if (s.loadMode === "ADDED") return `${s.weight} kg · BW +${s.loadDelta}`;
  if (s.loadMode === "ASSISTED") return `${s.weight} kg · assist −${s.loadDelta}`;
  return `${s.weight ?? "—"} kg`;
}

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="card card-pad grow" style={{ textAlign: "center" }}>
      <b className="mono" style={{ fontSize: 22, color }}>{value}</b>
      <div className="micro mt">{label}</div>
    </div>
  );
}

export default function ExerciseDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const save = useMutation({
    mutationFn: (patch: { restSeconds?: number | null; cardioMetrics?: CardioMetric[] }) => Api.updateExercise(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exercises"] }),
  });

  const ex = (exercises.data ?? []).find((e) => e.id === id);
  const cardio = ex ? isCardioEx(ex) : false;
  const curMetrics = ex ? cardioMetricsOf(ex) : [];
  const toggleMetric = (m: CardioMetric) =>
    save.mutate({ cardioMetrics: curMetrics.includes(m) ? (curMetrics.length > 1 ? curMetrics.filter((x) => x !== m) : curMetrics) : [...curMetrics, m] });
  const tName = useMemo(() => {
    const m = new Map((templates.data ?? []).map((t: TemplateDto) => [t.id, t.name]));
    return (w: WorkoutDto) => (w.templateId && m.get(w.templateId)) || "Workout";
  }, [templates.data]);

  const history = useMemo(() => (workouts.data ?? [])
    .map((w) => ({ w, block: w.exercises.find((b) => b.exerciseId === id) }))
    .filter((x): x is { w: WorkoutDto; block: NonNullable<typeof x.block> } => !!x.block)
    .sort((a, b) => b.w.startedAt.localeCompare(a.w.startedAt)), [workouts.data, id]);

  // chronological (oldest → newest) for trend charts
  const stats = useMemo(() => {
    const asc = [...history].reverse();
    const oneRm: Point[] = [], vol: Point[] = [], dist: Point[] = [];
    let topW = 0, topWReps = 0, bestRm = 0, bestVol = 0, longDist = 0, fastPace = Infinity, longTime = 0;
    for (const { w, block } of asc) {
      let s1 = 0, sv = 0, sd = 0;
      for (const s of block.sets) {
        if (s.kind === "CARDIO") {
          if (s.distanceM) { const m = parseFloat(s.distanceM); sd += m; longDist = Math.max(longDist, m); }
          if (s.durationS != null) longTime = Math.max(longTime, s.durationS);
          if (s.distanceM && s.durationS) fastPace = Math.min(fastPace, s.durationS / (parseFloat(s.distanceM) / 1000));
        } else if (s.setType === "WORKING" && s.weight) {
          const wgt = parseFloat(s.weight), reps = s.reps ?? 1;
          s1 = Math.max(s1, est1rm(wgt, reps)); sv += wgt * (s.reps ?? 0);
          if (wgt > topW) { topW = wgt; topWReps = s.reps ?? 0; }
          bestRm = Math.max(bestRm, est1rm(wgt, reps));
        }
      }
      const label = w.startedAt;
      if (s1 > 0) oneRm.push({ label, value: Math.round(s1) });
      if (sv > 0) vol.push({ label, value: Math.round(sv) });
      if (sd > 0) dist.push({ label, value: +(sd / 1000).toFixed(2) });
    }
    bestVol = vol.reduce((m, p) => Math.max(m, p.value), 0);
    return { oneRm, vol, dist, topW, topWReps, bestRm: Math.round(bestRm), bestVol, longDist, fastPace, longTime };
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
          <p><span className="tag">{cardio ? "Cardio" : equipmentLabel(ex.equipment)}</span> · {cardio ? "cardiovascular" : "strength"}</p>
        </div>
      </div>

      {/* per-exercise settings */}
      <div className="card card-pad fade-up" style={{ marginBottom: 14 }}>
        <span className="micro">Rest timer</span>
        <div className="chip-wrap" style={{ marginTop: 6 }}>
          {REST_PRESETS.map((p) => (
            <button key={String(p.v)} className={`chip-toggle${(ex.restSeconds ?? null) === p.v ? " on" : ""}`}
              disabled={save.isPending} onClick={() => save.mutate({ restSeconds: p.v == null ? -1 : p.v })}>{p.label}</button>
          ))}
        </div>
        {cardio && (
          <>
            <span className="micro" style={{ display: "block", marginTop: 14 }}>Metrics to log</span>
            <div className="chip-wrap" style={{ marginTop: 6 }}>
              {CARDIO_METRICS.map((m) => (
                <button key={m.value} className={`chip-toggle${curMetrics.includes(m.value) ? " on" : ""}`}
                  disabled={save.isPending} onClick={() => toggleMetric(m.value)}>{m.label}</button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* records */}
      <div className="row" style={{ gap: 12, marginBottom: 14 }}>
        <Stat value={String(history.length)} label="sessions" color="var(--ink)" />
        {cardio ? (
          <>
            <Stat value={stats.longDist ? `${(stats.longDist / 1000).toFixed(2)}` : "—"} label="longest km" color="var(--volt)" />
            <Stat value={Number.isFinite(stats.fastPace) ? fmtTime(Math.round(stats.fastPace)) : "—"} label="best /km" color="var(--ice)" />
          </>
        ) : (
          <>
            <Stat value={stats.topW ? `${stats.topW}` : "—"} label={`top kg${stats.topWReps ? ` ×${stats.topWReps}` : ""}`} color="var(--volt)" />
            <Stat value={stats.bestRm ? `${stats.bestRm}` : "—"} label="est. 1RM kg" color="var(--ice)" />
          </>
        )}
      </div>

      {/* trends */}
      {cardio
        ? <ChartCard title="Distance per session" yLabel="Distance (km)" points={stats.dist} color="var(--volt)" />
        : <>
            <ChartCard title="Estimated 1RM" yLabel="Est. 1RM (kg)" points={stats.oneRm} color="var(--volt)" />
            <ChartCard title="Volume per session" yLabel="Volume (kg)" points={stats.vol} color="var(--ice)" />
          </>}

      <p className="micro" style={{ margin: "18px 4px 10px" }}>History</p>
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
              {block.note && <div className="block-note">“{block.note}”</div>}
              {block.sets.map((s, i) => {
                const warm = s.setType === "WARMUP";
                return (
                  <div key={i} className="detail-row">
                    <span className={`set-idx${warm ? " warm" : ""}`} style={{ cursor: "default" }}>{warm ? "W" : String(++workingNo)}</span>
                    <span className="readout grow">{loadLabel(s)}</span>
                    {!cardio && <span className="mono detail-reps">{s.reps ?? "—"} <span className="micro">reps</span></span>}
                    {!cardio && <span className="mono detail-rpe">{s.rpe != null ? `RPE ${s.rpe}` : "—"}</span>}
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
