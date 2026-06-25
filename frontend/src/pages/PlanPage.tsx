import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import { LANDMARKS, MUSCLES, muscleLabel, trainsMuscle, weeklyMuscleSets } from "../muscles";
import { blockLabel, currentMicro, planMacrocycle, planStructureKey, scheduleNotes, targetSets, PER_SESSION_CAP } from "../periodization";
import type { ExerciseDto, GoalType, Muscle } from "../api/types";
import { useSettings } from "../settings";
import CompletionScreen from "./CompletionScreen";
import WeekCalendar from "../components/WeekCalendar";

/** Highest contribution fraction an exercise gives a muscle (for ranking dropdown candidates). */
const fracOf = (e: ExerciseDto, m: Muscle): number =>
  e.muscleContributions.reduce((f, c) => (c.muscle === m ? Math.max(f, parseFloat(c.fraction)) : f), 0);

/** Human-readable block phase name (replaces bare enum in timeline chips). */
const blockPhaseLabel = (blockType: string | null | undefined): string => {
  if (!blockType) return "";
  switch (blockType) {
    case "HYPERTROPHY": return "Hypertrophy";
    case "STRENGTH":    return "Strength phase";
    case "PEAK":        return "Peak";
    case "DELOAD":      return "Deload";
    default:            return blockType.charAt(0) + blockType.slice(1).toLowerCase();
  }
};

/** One-line plain-English caption for each block type, shown under the timeline chip. */
const blockCaption = (blockType: string | null | undefined): string => {
  if (!blockType) return "";
  switch (blockType) {
    case "HYPERTROPHY": return "High volume — grow muscle";
    case "STRENGTH":    return "Intensification — potentiates the next hypertrophy block";
    case "PEAK":        return "Low volume, max intensity — express strength";
    case "DELOAD":      return "Recovery — let adaptations set in";
    default:            return "";
  }
};

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 2) / 2;

export default function PlanPage() {
  const qc = useQueryClient();
  const settings = useSettings();
  const plan = useQuery({ queryKey: ["plan"], queryFn: Api.getPlan });
  const history = useQuery({ queryKey: ["plan", "history"], queryFn: Api.planHistory });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const splits = useQuery({ queryKey: ["splits"], queryFn: Api.listSplits });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });

  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmAdvance, setConfirmAdvance] = useState(false);
  const [usePlanAgainPrefill, setUsePlanAgainPrefill] = useState(false);

  const contribsOf = useMemo(() => {
    const m = new Map((exercises.data ?? []).map((e) => [e.id, e.muscleContributions]));
    return (id: string) => m.get(id);
  }, [exercises.data]);
  const actual = useMemo(
    () => weeklyMuscleSets(workouts.data ?? [], contribsOf, Date.now() - 7 * DAY, Date.now() + DAY),
    [workouts.data, contribsOf]);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["plan"] });
    qc.invalidateQueries({ queryKey: ["plan", "history"] });
  };

  const advance = useMutation({ mutationFn: Api.advancePlan, onSuccess: invalidateAll });
  const end = useMutation({
    mutationFn: Api.endPlan,
    onSuccess: () => {
      setConfirmEnd(false);
      invalidateAll();
    },
  });

  if (plan.isLoading || history.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (plan.isError || history.isError) return <QueryError onRetry={() => { plan.refetch(); history.refetch(); }} />;

  // No active plan — check for an unacknowledged COMPLETED terminal plan
  if (!plan.data) {
    const newestTerminal = (history.data ?? [])[0] ?? null;
    if (
      newestTerminal &&
      newestTerminal.status === "COMPLETED" &&
      newestTerminal.id !== settings.dismissedCompletionPlanId
    ) {
      const dismiss = () => settings.setDismissedCompletionPlanId(newestTerminal.id);
      return (
        <CompletionScreen
          plan={newestTerminal}
          onStartNew={() => { setUsePlanAgainPrefill(false); dismiss(); }}
          onPlanAgain={() => { setUsePlanAgainPrefill(true); dismiss(); }}
          onDismiss={() => { setUsePlanAgainPrefill(false); dismiss(); }}
        />
      );
    }

    // Determine prefill if returning to builder after "plan again"
    const prevCompleted = usePlanAgainPrefill && settings.dismissedCompletionPlanId
      ? (history.data ?? []).find((p) => p.id === settings.dismissedCompletionPlanId)
      : null;
    const initial = prevCompleted
      ? {
          goal: (prevCompleted.goal ?? "GENERAL_HYPERTROPHY") as GoalType,
          days: 4,
          focus: (prevCompleted.focusMuscles ?? []) as Muscle[],
          targetDate: prevCompleted.targetDate ?? undefined,
        }
      : undefined;

    return <MacroPlanner onCreated={invalidateAll} initial={initial} />;
  }

  const p = plan.data;
  const micro = currentMicro(p);
  const meso = micro?.meso;
  const shownMuscles = (meso && meso.focusMuscles.length ? meso.focusMuscles : MUSCLES.map((m) => m.key)) as Muscle[];

  // Is this the very last advance — completing the plan?
  const isLastAdvance = (() => {
    if (!micro || !meso) return false;
    const lastMesoIdx = p.mesocycles.length - 1;
    const deloadWeek = meso.accumulationWeeks + 1;
    return p.mesoIndex === lastMesoIdx && micro.week === deloadWeek;
  })();

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>{p.name}</h1>
          {meso && (
            <p>
              <span className="tag">{blockLabel(meso.blockType)}</span> · Block {micro!.mesoNumber}/{micro!.mesoCount} · Week {micro!.week}/{micro!.weeks} <span className="tag">{micro!.isDeload ? "DELOAD" : "ACCUM"}</span> · {meso.phase.toLowerCase()}
              {meso.intensityBand && <> · {meso.intensityBand.repLow}–{meso.intensityBand.repHigh} reps</>}
            </p>
          )}
        </div>
      </div>

      {/* whole-macro timeline */}
      <div style={{ overflowX: "auto" }}>
        <div className="plan-timeline fade-up">
          {p.mesocycles.map((b, i) => (
            <div key={i} className={`plan-block${i === p.mesoIndex ? " cur" : ""}`}>
              <span className="tag" style={{ fontSize: 13 }}>{blockPhaseLabel(b.blockType)}</span>
              <b className="mono">{b.accumulationWeeks + 1}w</b>
              <span className="micro" style={{ fontSize: 11 }}>{blockCaption(b.blockType)}</span>
              {b.focusMuscles.length > 0 && <span className="micro" style={{ fontSize: 11 }}>{b.focusMuscles.map(muscleLabel).join("/")}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* weekly schedule (read-only) derived from the plan's persisted split */}
      {(() => {
        const split = (splits.data ?? []).find((s) => s.id === p.splitId);
        if (!split?.weekdays?.length) return null;
        const nameById = new Map((templates.data ?? []).map((t) => [t.id, t.name]));
        const tmpls = split.templateIds.map((id) => ({ name: nameById.get(id) ?? "Session" }));
        return <WeekCalendar templates={tmpls} schedule={split.weekdays} />;
      })()}

      {/* deload prompt (suggest, don't force) */}
      {(() => {
        if (!meso) return null;
        const atMrv = shownMuscles.filter((mk) => (actual[mk] ?? 0) >= LANDMARKS[mk].mrv);
        if (micro?.isDeload)
          return <div className="card card-pad" style={{ marginBottom: 14, borderColor: "var(--ice)" }}><span className="micro" style={{ color: "var(--ice)" }}>Deload week</span><p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Back off — ~½ the sets, +2–3 RIR. Targets already dropped; mark sessions as deload on Start.</p></div>;
        if (atMrv.length)
          return <div className="card card-pad" style={{ marginBottom: 14, borderColor: "var(--ember)" }}><span className="micro" style={{ color: "var(--ember)" }}>Deload suggested</span><p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{atMrv.map(muscleLabel).join(", ")} at max recoverable volume — consider deloading soon.</p></div>;
        if (micro && micro.week === meso.accumulationWeeks)
          return <div className="card card-pad" style={{ marginBottom: 14 }}><p className="muted" style={{ fontSize: 12, margin: 0 }}>Final hard week of this block — deload comes next.</p></div>;
        return null;
      })()}

      {meso && (
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
        {micro?.isDeload
          ? "Deload week — targets drop to ~MV; log sessions as deload (auto-marked on Start)."
          : "Target sets for this week (after “/”) vs your last 7 days (before “/”)."}
      </p>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {/* Complete week / Finish plan: two-step inline confirm — irreversible action */}
        {confirmAdvance ? (
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {isLastAdvance ? "Finish plan? This can't be undone." : "Advance to next week? This can't be undone."}
            </span>
            <button className="btn btn-volt" disabled={advance.isPending} onClick={() => { setConfirmAdvance(false); advance.mutate(); }}>
              {advance.isPending ? "Advancing…" : "Confirm"}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmAdvance(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="btn btn-volt"
            disabled={advance.isPending}
            onClick={() => setConfirmAdvance(true)}
          >
            {isLastAdvance ? "Finish plan →" : "Complete week →"}
          </button>
        )}

        {/* End plan: two-step inline confirm — no window.confirm */}
        {confirmEnd ? (
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 13 }}>End this plan? It's saved to your history.</span>
            <button className="btn btn-volt" disabled={end.isPending} onClick={() => end.mutate()}>
              {end.isPending ? "Ending…" : "Confirm"}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmEnd(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmEnd(true)}>End plan</button>
        )}
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

interface MacroPlannerProps {
  onCreated: () => void;
  initial?: { goal: GoalType; days?: number; focus?: Muscle[]; targetDate?: string };
}

function MacroPlanner({ onCreated, initial }: MacroPlannerProps) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const energy = useQuery({ queryKey: ["energy"], queryFn: Api.energy });

  const [goal, setGoal] = useState<GoalType>(initial?.goal ?? "GENERAL_HYPERTROPHY");
  const [months, setMonths] = useState(6);
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [days, setDays] = useState(initial?.days ?? 4);
  const [focus, setFocus] = useState<Muscle[]>(initial?.focus ?? []);
  const needsFocus = goal === "MUSCLE_FOCUS" || goal === "CONTEST_PREP";
  const usesDate = goal === "CONTEST_PREP";
  const toggle = (m: Muscle) => setFocus((f) => (f.includes(m) ? f.filter((x) => x !== m) : f.length >= 3 ? f : [...f, m]));

  // clamp the plan's block phases by the Coach's measured phase, but only when confidently measured
  const measuredPhase = energy.data?.status === "READY" && energy.data.confidence === "HIGH" && energy.data.phase !== "UNKNOWN"
    ? energy.data.phase : null;
  const preview = useMemo(() => {
    if (!exercises.data) return null;
    if (usesDate && !targetDate) return null;
    // pass the measured phase + its confidence; the planner applies the override only at HIGH confidence
    return planMacrocycle(goal, months * 4, usesDate ? targetDate : null, focus, days, exercises.data, measuredPhase, measuredPhase ? "HIGH" : null);
  }, [goal, months, targetDate, focus, days, exercises.data, usesDate, measuredPhase]);

  const planName = useMemo(() => {
    const g = GOALS.find((x) => x.v === goal)!.label;
    return usesDate ? `${g} — to ${targetDate}` : `${g} — ${months} mo`;
  }, [goal, months, targetDate, usesDate]);

  // Catalog exercises that train each muscle (≥0.5 basis), strongest contributor first — the dropdown options
  // per slot. Built once per catalog so each <select> isn't re-filtering the whole list.
  const candByMuscle = useMemo(() => {
    const m = new Map<Muscle, ExerciseDto[]>();
    for (const mk of MUSCLES.map((x) => x.key)) {
      m.set(mk, (exercises.data ?? [])
        .filter((e) => e.category !== "CARDIO" && trainsMuscle(e.muscleContributions, mk))
        .sort((a, b) => fracOf(b, mk) - fracOf(a, mk)));
    }
    return m;
  }, [exercises.data]);
  const exById = useMemo(() => new Map((exercises.data ?? []).map((e) => [e.id, e])), [exercises.data]);

  // The user's per-slot exercise choice (keyed "<dayIdx>:<slotIdx>") + weekday assignment. Seeded from the
  // planner's defaults, then RE-SEEDED only when the slot STRUCTURE changes (planStructureKey) — NOT on every
  // `preview` recompute. A background catalog refetch or the async energy phase resolving produces a new
  // `preview` object with the same structure; keying the reset on the structural fingerprint preserves the
  // user's edits across those. If a real structural change (goal/days/volume) discards edits, we flag it.
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [sched, setSched] = useState<number[]>([]);
  const [resetNotice, setResetNotice] = useState(false);
  const editedRef = useRef(false);
  const prevKeyRef = useRef("");
  const markEdited = () => { editedRef.current = true; setResetNotice(false); };
  const structKey = useMemo(() => (preview ? planStructureKey(preview) : ""), [preview]);
  useEffect(() => {
    if (!preview) return;
    const init: Record<string, string> = {};
    preview.templates.forEach((t, di) => t.slots.forEach((s, si) => { if (s.exerciseId) init[`${di}:${si}`] = s.exerciseId; }));
    setPicks(init);
    setSched(preview.schedule ?? []);
    if (prevKeyRef.current && prevKeyRef.current !== structKey && editedRef.current) setResetNotice(true);
    prevKeyRef.current = structKey;
    editedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on structKey, not `preview`
  }, [structKey]);
  const recoveryNotes = useMemo(() => scheduleNotes(preview?.templates ?? [], sched), [preview, sched]);
  const catalogGaps = (preview?.warnings ?? []).filter((w) => /No exercise/i.test(w));

  const accept = useMutation({
    mutationFn: async () => {
      const pv = preview!;
      const ids: string[] = [];
      const weekdays: number[] = [];
      for (let di = 0; di < pv.templates.length; di++) {   // index-based so slot keys match `picks`
        const t = pv.templates[di];
        // Resolve each slot to the user's pick (or its default) and merge slots that landed on the same
        // exercise — summing sets, capped — so a duplicate choice doesn't create two identical template rows.
        const merged = new Map<string, { exerciseId: string; name: string; sets: number; reps: number; targetRir: string }>();
        t.slots.forEach((s, si) => {
          const exId = picks[`${di}:${si}`] ?? s.exerciseId;
          if (!exId) return;
          const name = exById.get(exId)?.name ?? s.name ?? "";
          const cur = merged.get(exId);
          if (cur) cur.sets = Math.min(PER_SESSION_CAP, cur.sets + s.sets);
          else merged.set(exId, { exerciseId: exId, name, sets: s.sets, reps: s.reps, targetRir: s.targetRir });
        });
        const exercises = [...merged.values()];
        if (!exercises.length) continue;
        const created = await Api.createTemplate({ name: t.name, exercises: exercises.map((e, i) => ({ exerciseId: e.exerciseId, name: e.name, position: i, sets: e.sets, reps: e.reps, targetRir: e.targetRir })) });
        ids.push(created.id);
        weekdays.push(sched[di] ?? di);   // keep weekdays aligned to the templates we actually created
      }
      let splitId: string | undefined;
      if (ids.length) splitId = (await Api.createSplit({ name: pv.splitName, templateIds: ids, weekdays })).id;
      await Api.createPlan({ name: planName, mesocycles: pv.mesocycles, goal, targetDate: usesDate ? targetDate : undefined, focusMuscles: needsFocus ? focus : undefined, splitId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      qc.invalidateQueries({ queryKey: ["splits"] });
      onCreated();
    },
  });

  if (exercises.isError) return <QueryError onRetry={exercises.refetch} />;

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
        {coachPhase && <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Coach reads your current phase as <b>{coachPhase.toLowerCase()}</b>{measuredPhase === "DEFICIT" ? " — surplus blocks are downgraded to maintenance while you're cutting." : "."}</p>}
      </div>

      {preview && (
        <>
          <p className="micro" style={{ margin: "20px 4px 8px" }}>Macrocycle · {preview.mesocycles.length} blocks · ~{preview.totalWeeks} weeks</p>
          <div style={{ overflowX: "auto" }}>
            <div className="plan-timeline">
              {preview.mesocycles.map((b, i) => (
                <div key={i} className={`plan-block${i === 0 ? " cur" : ""}`}>
                  <span className="tag" style={{ fontSize: 13 }}>{blockPhaseLabel(b.blockType)}</span>
                  <b className="mono">{b.accumulationWeeks + 1}w</b>
                  <span className="micro" style={{ fontSize: 11 }}>{blockCaption(b.blockType)}</span>
                  {b.focusMuscles.length > 0 && <span className="micro" style={{ fontSize: 11 }}>{b.focusMuscles.map(muscleLabel).join("/")}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* editable weekly schedule — reassign sessions across weekdays; recovery notes recompute live */}
          <WeekCalendar templates={preview.templates} schedule={sched.length === preview.templates.length ? sched : preview.schedule} editable onChange={(next) => { markEdited(); setSched(next); }} />

          {resetNotice && (
            <div className="card card-pad" style={{ margin: "12px 0", borderColor: "var(--ember)" }}>
              <span className="micro" style={{ color: "var(--ember)" }}>Selections reset</span>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Your weekday + exercise choices were reset because the plan structure changed. Re-customize below before accepting.</p>
            </div>
          )}

          {recoveryNotes.length > 0 && (
            <div className="card card-pad" style={{ margin: "12px 0", borderColor: "var(--ice)" }}>
              <span className="micro" style={{ color: "var(--ice)" }}>Recovery</span>
              {recoveryNotes.slice(0, 5).map((w, i) => <p key={i} className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{w}</p>)}
            </div>
          )}
          {catalogGaps.length > 0 && (
            <div className="card card-pad" style={{ margin: "12px 0", borderColor: "var(--ember)" }}>
              <span className="micro" style={{ color: "var(--ember)" }}>Catalog gaps</span>
              {catalogGaps.slice(0, 5).map((w, i) => <p key={i} className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{w}</p>)}
            </div>
          )}

          <p className="micro" style={{ margin: "16px 4px 8px" }}>Starter split · {preview.splitName} (block 1)</p>
          <p className="muted" style={{ fontSize: 12, margin: "0 4px 10px" }}>Each slot is a muscle-group placeholder pre-filled with a recommended lift — swap any to your preferred exercise before accepting.</p>
          <div className="stagger">
            {preview.templates.map((t, di) => (
              <section key={di} className="card ex-block">
                <div className="ex-head"><h3 style={{ fontSize: 16 }}>{t.name}</h3></div>
                {t.slots.map((s, si) => {
                  const cands = candByMuscle.get(s.muscle) ?? [];
                  return (
                    <div key={si} className="detail-row" style={{ gap: 8 }}>
                      <span className="tag" style={{ fontSize: 9, flexShrink: 0 }}>{muscleLabel(s.muscle)}</span>
                      {cands.length ? (
                        <select className="input mono grow" style={{ padding: "6px 8px", fontSize: 13 }}
                          value={picks[`${di}:${si}`] ?? s.exerciseId ?? ""}
                          onChange={(e) => { markEdited(); setPicks((p) => ({ ...p, [`${di}:${si}`]: e.target.value })); }}>
                          {cands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (
                        <span className="readout grow" style={{ color: "var(--ember)" }}>No {muscleLabel(s.muscle)} exercise — add one to your catalog</span>
                      )}
                      <span className="mono detail-reps" style={{ flexShrink: 0 }}>{s.sets} × {s.reps} <span className="micro">@ {s.targetRir} RIR</span></span>
                    </div>
                  );
                })}
                {t.slots.length === 0 && <div className="set-note">No catalog exercises matched this day.</div>}
              </section>
            ))}
          </div>

          <div className="action-bar">
            <button className="btn btn-ghost grow" onClick={() => nav("/muscles")}>Volume</button>
            <button className="btn btn-ghost grow" onClick={() => nav("/past-plans")}>Past plans</button>
            <button className="btn btn-volt grow btn-lg" disabled={accept.isPending} onClick={() => accept.mutate()}>
              {accept.isPending ? "Creating…" : "Accept & start"}
            </button>
          </div>
        </>
      )}
      {usesDate && !targetDate && <p className="muted" style={{ fontSize: 13, margin: "16px 4px" }}>Pick a show/meet date to generate the plan.</p>}
      {!preview && !usesDate && (
        <div className="action-bar">
          <button className="btn btn-ghost" onClick={() => nav("/past-plans")}>Past plans</button>
        </div>
      )}
    </main>
  );
}
