import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { MUSCLES, muscleLabel, weeklyMuscleSets } from "../muscles";
import { blockLabel, currentMicro, planMacrocycle, targetSets } from "../periodization";
import type { GoalType, Muscle } from "../api/types";

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 2) / 2;

export default function PlanPage() {
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ["plan"], queryFn: Api.getPlan });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });

  const contribsOf = useMemo(() => {
    const m = new Map((exercises.data ?? []).map((e) => [e.id, e.muscleContributions]));
    return (id: string) => m.get(id);
  }, [exercises.data]);
  const actual = useMemo(
    () => weeklyMuscleSets(workouts.data ?? [], contribsOf, Date.now() - 7 * DAY, Date.now() + DAY),
    [workouts.data, contribsOf]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["plan"] });
  const advance = useMutation({ mutationFn: Api.advancePlan, onSuccess: invalidate });
  const end = useMutation({ mutationFn: Api.endPlan, onSuccess: invalidate });

  if (plan.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (!plan.data) return <MacroPlanner onCreated={invalidate} />;

  const p = plan.data;
  const micro = currentMicro(p);
  const meso = micro?.meso;
  const done = p.status === "COMPLETED";
  const shownMuscles = (meso && meso.focusMuscles.length ? meso.focusMuscles : MUSCLES.map((m) => m.key)) as Muscle[];

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>{p.name}</h1>
          {meso && (
            <p>
              <span className="tag">{blockLabel(meso.blockType)}</span> · Block {micro!.mesoNumber}/{micro!.mesoCount} · {done ? "complete" : <>Week {micro!.week}/{micro!.weeks} <span className="tag">{micro!.isDeload ? "DELOAD" : "ACCUM"}</span></>} · {meso.phase.toLowerCase()}
              {meso.intensityBand && <> · {meso.intensityBand.repLow}–{meso.intensityBand.repHigh} reps</>}
            </p>
          )}
        </div>
      </div>

      {/* whole-macro timeline */}
      <div className="plan-timeline fade-up">
        {p.mesocycles.map((b, i) => (
          <div key={i} className={`plan-block${i === p.mesoIndex ? " cur" : ""}`}>
            <span className="tag" style={{ fontSize: 9 }}>{blockLabel(b.blockType)}</span>
            <b className="mono">{b.accumulationWeeks + 1}w</b>
            {b.focusMuscles.length > 0 && <span className="micro" style={{ fontSize: 9 }}>{b.focusMuscles.map(muscleLabel).join("/")}</span>}
          </div>
        ))}
      </div>

      {meso && !done && (
        <div className="card" style={{ marginBottom: 14 }}>
          {shownMuscles.map((mk, i) => {
            const tgt = targetSets(mk, meso, micro!.week);
            const act = round(actual[mk] ?? 0);
            const pct = tgt > 0 ? Math.min(100, (act / tgt) * 100) : 0;
            return (
              <div key={mk} className="mvol-row" style={{ borderTop: i ? "1px solid var(--line)" : "none" }}>
                <span className="mvol-label">{muscleLabel(mk)}</span>
                <div className="mvol-bar"><div className="mvol-fill" style={{ width: `${pct}%`, background: act >= tgt ? "var(--volt)" : "var(--ice)" }} /></div>
                <span className="mvol-sets mono" style={{ width: 46 }}>{act}/{tgt}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, margin: "0 4px 14px" }}>
        {done ? "Plan complete — start a new plan or end it."
          : micro?.isDeload ? "Deload week — targets drop to ~MV; log sessions as deload (auto-marked on Start)."
            : "Target sets for this week (after “/”) vs your last 7 days (before “/”)."}
      </p>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {!done && <button className="btn btn-volt" disabled={advance.isPending} onClick={() => advance.mutate()}>Complete week →</button>}
        <button className="btn btn-ghost" disabled={end.isPending} onClick={() => end.mutate()}>End plan</button>
      </div>
    </main>
  );
}

const GOALS: { v: GoalType; label: string }[] = [
  { v: "GENERAL_HYPERTROPHY", label: "Build muscle" },
  { v: "MUSCLE_FOCUS", label: "Focus muscles" },
  { v: "STRENGTH", label: "Strength" },
  { v: "CONTEST_PREP", label: "Contest prep" },
];
const MONTHS = [3, 4, 6, 9, 12];
const DAYS = [2, 3, 4, 5, 6];

function MacroPlanner({ onCreated }: { onCreated: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const energy = useQuery({ queryKey: ["energy"], queryFn: Api.energy });

  const [goal, setGoal] = useState<GoalType>("GENERAL_HYPERTROPHY");
  const [months, setMonths] = useState(6);
  const [targetDate, setTargetDate] = useState("");
  const [days, setDays] = useState(4);
  const [focus, setFocus] = useState<Muscle[]>([]);
  const needsFocus = goal === "MUSCLE_FOCUS" || goal === "CONTEST_PREP";
  const usesDate = goal === "CONTEST_PREP";
  const toggle = (m: Muscle) => setFocus((f) => (f.includes(m) ? f.filter((x) => x !== m) : f.length >= 3 ? f : [...f, m]));

  const preview = useMemo(() => {
    if (!exercises.data) return null;
    if (usesDate && !targetDate) return null;
    return planMacrocycle(goal, months * 4, usesDate ? targetDate : null, focus, days, exercises.data);
  }, [goal, months, targetDate, focus, days, exercises.data, usesDate]);

  const planName = useMemo(() => {
    const g = GOALS.find((x) => x.v === goal)!.label;
    return usesDate ? `${g} — to ${targetDate}` : `${g} — ${months} mo`;
  }, [goal, months, targetDate, usesDate]);

  const accept = useMutation({
    mutationFn: async () => {
      const pv = preview!;
      const ids: string[] = [];
      for (const t of pv.templates) {
        if (!t.exercises.length) continue;
        const created = await Api.createTemplate({ name: t.name, exercises: t.exercises.map((e, i) => ({ exerciseId: e.exerciseId, name: e.name, position: i, sets: e.sets })) });
        ids.push(created.id);
      }
      if (ids.length) await Api.createSplit({ name: pv.splitName, templateIds: ids });
      await Api.createPlan({ name: planName, mesocycles: pv.mesocycles, goal, targetDate: usesDate ? targetDate : undefined, focusMuscles: needsFocus ? focus : undefined });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["splits"] });
      onCreated();
    },
  });

  const todayIso = new Date().toISOString().slice(0, 10);
  const coachPhase = energy.data?.status === "READY" && energy.data.phase !== "UNKNOWN" ? energy.data.phase : null;

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div><h1>Plan a macrocycle</h1><p>Goal + duration → a sequence of mesocycle blocks + a starter split.</p></div>
      </div>

      <div className="card card-pad fade-up">
        <span className="micro">Goal</span>
        <div className="seg" style={{ width: "100%", marginTop: 6, flexWrap: "wrap" }}>
          {GOALS.map((o) => <button key={o.v} className={goal === o.v ? "on" : ""} style={{ flex: "1 0 40%", fontSize: 12 }} onClick={() => setGoal(o.v)}>{o.label}</button>)}
        </div>

        {usesDate ? (
          <>
            <span className="micro" style={{ display: "block", marginTop: 16 }}>Show / meet date</span>
            <input className="input mono" type="date" min={todayIso} style={{ marginTop: 6 }} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </>
        ) : (
          <>
            <span className="micro" style={{ display: "block", marginTop: 16 }}>Duration (months)</span>
            <div className="seg" style={{ width: "100%", marginTop: 6 }}>
              {MONTHS.map((m) => <button key={m} className={months === m ? "on" : ""} style={{ flex: 1 }} onClick={() => setMonths(m)}>{m}</button>)}
            </div>
          </>
        )}

        <span className="micro" style={{ display: "block", marginTop: 16 }}>Training days / week</span>
        <div className="seg" style={{ width: "100%", marginTop: 6 }}>
          {DAYS.map((d) => <button key={d} className={days === d ? "on" : ""} style={{ flex: 1 }} onClick={() => setDays(d)}>{d}</button>)}
        </div>

        {needsFocus && (
          <>
            <span className="micro" style={{ display: "block", marginTop: 16 }}>Focus / weak-point muscles (up to 3)</span>
            <div className="chip-wrap" style={{ marginTop: 6 }}>
              {MUSCLES.map((m) => <button key={m.key} className={`chip-toggle${focus.includes(m.key) ? " on" : ""}`} onClick={() => toggle(m.key)}>{m.label}</button>)}
            </div>
          </>
        )}
        {coachPhase && <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Coach reads your current phase as <b>{coachPhase.toLowerCase()}</b>; blocks set their own surplus/deficit by goal.</p>}
      </div>

      {preview && (
        <>
          <p className="micro" style={{ margin: "20px 4px 8px" }}>Macrocycle · {preview.mesocycles.length} blocks · ~{preview.totalWeeks} weeks</p>
          <div className="plan-timeline">
            {preview.mesocycles.map((b, i) => (
              <div key={i} className={`plan-block${i === 0 ? " cur" : ""}`}>
                <span className="tag" style={{ fontSize: 9 }}>{blockLabel(b.blockType)}</span>
                <b className="mono">{b.accumulationWeeks + 1}w</b>
                <span className="micro" style={{ fontSize: 9 }}>{b.phase.toLowerCase()}</span>
                {b.focusMuscles.length > 0 && <span className="micro" style={{ fontSize: 9 }}>{b.focusMuscles.map(muscleLabel).join("/")}</span>}
              </div>
            ))}
          </div>

          {preview.warnings.length > 0 && (
            <div className="card card-pad" style={{ margin: "12px 0", borderColor: "var(--ember)" }}>
              <span className="micro" style={{ color: "var(--ember)" }}>Catalog gaps</span>
              {preview.warnings.slice(0, 5).map((w, i) => <p key={i} className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{w}</p>)}
            </div>
          )}

          <p className="micro" style={{ margin: "16px 4px 8px" }}>Starter split · {preview.splitName} (block 1)</p>
          <div className="stagger">
            {preview.templates.map((t, i) => (
              <section key={i} className="card ex-block">
                <div className="ex-head"><h3 style={{ fontSize: 16 }}>{t.name}</h3></div>
                {t.exercises.map((e) => (
                  <div key={e.exerciseId} className="detail-row">
                    <span className="readout grow">{e.name}</span>
                    <span className="mono detail-reps">{e.sets} <span className="micro">sets</span></span>
                  </div>
                ))}
                {t.exercises.length === 0 && <div className="set-note">No catalog exercises matched this day.</div>}
              </section>
            ))}
          </div>

          <div className="action-bar">
            <button className="btn btn-ghost grow" onClick={() => nav("/muscles")}>Volume</button>
            <button className="btn btn-volt grow btn-lg" disabled={accept.isPending} onClick={() => accept.mutate()}>
              {accept.isPending ? "Creating…" : "Accept & start"}
            </button>
          </div>
        </>
      )}
      {usesDate && !targetDate && <p className="muted" style={{ fontSize: 13, margin: "16px 4px" }}>Pick a show/meet date to generate the plan.</p>}
    </main>
  );
}
