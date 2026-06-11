import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { CARDIO_METRICS, EQUIPMENT, RestPicker, cardioMetricsOf, equipmentLabel, isCardioEx, paceSpeed } from "../logging/engine";
import { ChartCard, type Point } from "../components/Chart";
import { EXERCISE_CHARTS } from "../charts";
import { MUSCLES } from "../muscles";
import { isDeload } from "../periodization";
import { e1rm as est1rm } from "../prescription";
import { useSettings } from "../settings";
import type { CardioMetric, Equipment, Laterality, Mechanic, Muscle, MuscleContributionDto, SetDto, TemplateDto, WorkoutDto } from "../api/types";

const LATERALITY: { v: Laterality; label: string }[] = [
  { v: "BILATERAL", label: "Bilateral" }, { v: "ISOLATERAL", label: "Isolateral" }, { v: "UNILATERAL", label: "Unilateral" },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

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
  const { charts } = useSettings();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const save = useMutation({
    mutationFn: (patch: { restSeconds?: number | null; cardioMetrics?: CardioMetric[]; muscleContributions?: MuscleContributionDto[]; equipment?: Equipment; laterality?: Laterality; mechanic?: Mechanic; loadable?: boolean }) => Api.updateExercise(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exercises"] }),
  });

  const ex = (exercises.data ?? []).find((e) => e.id === id);
  const cardio = ex ? isCardioEx(ex) : false;
  const curMetrics = ex ? cardioMetricsOf(ex) : [];
  const toggleMetric = (m: CardioMetric) =>
    save.mutate({ cardioMetrics: curMetrics.includes(m) ? (curMetrics.length > 1 ? curMetrics.filter((x) => x !== m) : curMetrics) : [...curMetrics, m] });
  const fracOf = new Map((ex?.muscleContributions ?? []).map((c) => [c.muscle, c.fraction]));
  const cycleMuscle = (m: Muscle) => {
    const cur = ex?.muscleContributions ?? [];
    const f = fracOf.get(m);
    const next: MuscleContributionDto[] =
      !f ? [...cur, { muscle: m, fraction: "1.0" }]
        : f === "1.0" ? cur.map((c) => (c.muscle === m ? { muscle: m, fraction: "0.5" } : c))
          : cur.filter((c) => c.muscle !== m);
    // a compound movement needs ≥2 muscles — drop to isolation if removing one would break that
    const patch: { muscleContributions: MuscleContributionDto[]; mechanic?: Mechanic } = { muscleContributions: next };
    if (next.length < 2 && ex?.mechanic === "COMPOUND") patch.mechanic = "ISOLATION";
    save.mutate(patch);
  };
  const tName = useMemo(() => {
    const m = new Map((templates.data ?? []).map((t: TemplateDto) => [t.id, t.name]));
    return (w: WorkoutDto) => (w.templateId && m.get(w.templateId)) || "Workout";
  }, [templates.data]);

  const history = useMemo(() => (workouts.data ?? [])
    .map((w) => ({ w, block: w.exercises.find((b) => b.exerciseId === id) }))
    .filter((x): x is { w: WorkoutDto; block: NonNullable<typeof x.block> } => !!x.block)
    .sort((a, b) => b.w.startedAt.localeCompare(a.w.startedAt)), [workouts.data, id]);

  // chronological (oldest → newest) for trend charts — deload sessions excluded from the trajectory
  const stats = useMemo(() => {
    const asc = [...history].reverse().filter((x) => !isDeload(x.w));
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
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <span className="tag">{cardio ? "Cardio" : equipmentLabel(ex.equipment)}</span>
            {ex.mechanic && <span className="tag">{ex.mechanic === "COMPOUND" ? "Compound" : "Isolation"}</span>}
            {ex.laterality && <span className="tag">{ex.laterality === "BILATERAL" ? "Bilateral" : ex.laterality === "ISOLATERAL" ? "Isolateral" : "Unilateral"}</span>}
            {ex.isBodyweight && <span className="tag tag-bw">Bodyweight{ex.loadable ? " · loadable" : ""}</span>}
          </div>
        </div>
      </div>

      {/* per-exercise settings */}
      <div className="card card-pad fade-up" style={{ marginBottom: 14 }}>
        <span className="micro">Rest timer</span>
        <div style={{ marginTop: 6 }}>
          <RestPicker initial={ex.restSeconds} onChange={(v) => save.mutate({ restSeconds: v == null ? -1 : v })} />
        </div>
        {cardio ? (
          <>
            <span className="micro" style={{ display: "block", marginTop: 14 }}>Metrics to log</span>
            <div className="chip-wrap" style={{ marginTop: 6 }}>
              {CARDIO_METRICS.map((m) => (
                <button key={m.value} className={`chip-toggle${curMetrics.includes(m.value) ? " on" : ""}`}
                  disabled={save.isPending} onClick={() => toggleMetric(m.value)}>{m.label}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <span className="micro" style={{ display: "block", marginTop: 14 }}>Load type</span>
            <div className="chip-wrap" style={{ marginTop: 6 }}>
              {EQUIPMENT.map((eq) => (
                <button key={eq.value} className={`chip-toggle${ex.equipment === eq.value ? " on" : ""}`}
                  disabled={save.isPending} onClick={() => save.mutate({ equipment: eq.value })}>{eq.label}</button>
              ))}
            </div>

            <span className="micro" style={{ display: "block", marginTop: 14 }}>Movement</span>
            <div className="seg" style={{ width: "100%", marginTop: 6 }}>
              <button className={ex.mechanic === "ISOLATION" ? "on" : ""} style={{ flex: 1 }}
                disabled={save.isPending} onClick={() => save.mutate({ mechanic: "ISOLATION" })}>Isolation</button>
              <button className={ex.mechanic === "COMPOUND" ? "on" : ""} style={{ flex: 1 }}
                disabled={save.isPending || ex.muscleContributions.length < 2}
                title={ex.muscleContributions.length < 2 ? "Select 2+ muscles first" : ""}
                onClick={() => save.mutate({ mechanic: "COMPOUND" })}>Compound</button>
            </div>
            <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {ex.muscleContributions.length < 2 ? "Compound needs 2+ muscles selected below." : "Compound works multiple muscles; isolation targets one."}
            </p>

            <span className="micro" style={{ display: "block", marginTop: 14 }}>
              Muscles worked {ex.muscleContributions.length === 0 && <b style={{ color: "var(--ember)" }}>· unmapped</b>}
            </span>
            <p className="muted" style={{ fontSize: 11, margin: "2px 0 6px" }}>Tap to cycle: off → primary → secondary. Credits per-muscle weekly volume.</p>
            <div className="chip-wrap">
              {MUSCLES.map((m) => {
                const f = fracOf.get(m.key);
                const cls = f === "1.0" ? " on" : f ? " half" : "";
                return (
                  <button key={m.key} className={`chip-toggle${cls}`} disabled={save.isPending}
                    title={f === "1.0" ? "primary" : f ? "secondary" : "off"}
                    onClick={() => cycleMuscle(m.key)}>{m.label}</button>
                );
              })}
            </div>

            <span className="micro" style={{ display: "block", marginTop: 14 }}>
              Loadability {ex.isBodyweight && <span className="muted">· can you add/assist resistance?</span>}
            </span>
            <div className="seg" style={{ width: "100%", marginTop: 6 }}>
              <button className={ex.loadable === true ? "on" : ""} style={{ flex: 1 }}
                disabled={save.isPending} onClick={() => save.mutate({ loadable: true })}>Loadable</button>
              <button className={ex.loadable === false ? "on" : ""} style={{ flex: 1 }}
                disabled={save.isPending} onClick={() => save.mutate({ loadable: false })}>Fixed</button>
            </div>
          </>
        )}

        <span className="micro" style={{ display: "block", marginTop: 14 }}>Laterality</span>
        <div className="seg" style={{ width: "100%", marginTop: 6 }}>
          {LATERALITY.map((l) => (
            <button key={l.v} className={ex.laterality === l.v ? "on" : ""} style={{ flex: 1, fontSize: 12 }}
              disabled={save.isPending} onClick={() => save.mutate({ laterality: l.v })}>{l.label}</button>
          ))}
        </div>
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

      {/* trends — driven by the chart catalog + Settings → Graphs (deload sessions excluded) */}
      {(() => {
        const asc = [...history].reverse().filter((x) => !isDeload(x.w));
        const mine = EXERCISE_CHARTS.filter((c) => c.cardio === cardio && charts.includes(c.key));
        if (mine.length === 0) return <p className="muted" style={{ fontSize: 13, margin: "0 4px 12px" }}>No graphs selected — turn some on in Settings → Graphs.</p>;
        return mine.map((c, i) => {
          const pts = asc.map(({ w, block }) => ({ label: w.startedAt, value: c.value(block) }))
            .filter((p): p is Point => p.value != null);
          return pts.length ? <ChartCard key={c.key} title={c.label} yLabel={c.yLabel} points={pts}
            format={c.format} color={i % 2 ? "var(--ice)" : "var(--volt)"} /> : null;
        });
      })()}

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
                  <h3 style={{ fontSize: 16 }}>{fmtDate(w.startedAt)} {isDeload(w) && <span className="tag" style={{ fontSize: 9 }}>DELOAD</span>}</h3>
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
