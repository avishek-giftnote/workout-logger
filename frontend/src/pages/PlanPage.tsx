import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { MUSCLES, muscleLabel, weeklyMuscleSets } from "../muscles";
import { currentMicro, targetSets } from "../periodization";
import type { Muscle } from "../api/types";

const PHASES: { v: string; label: string }[] = [
  { v: "SURPLUS", label: "Surplus" }, { v: "MAINTENANCE", label: "Maintenance" }, { v: "DEFICIT", label: "Deficit" },
];
const ACCUM = [3, 4, 5, 6];
const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 2) / 2;

export default function PlanPage() {
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ["plan"], queryFn: Api.getPlan });
  const energy = useQuery({ queryKey: ["energy"], queryFn: Api.energy });
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
  const addMeso = useMutation({ mutationFn: Api.addMesocycle, onSuccess: invalidate });

  if (plan.isLoading) return <main className="screen"><div className="spinner" /></main>;

  if (!plan.data) {
    const def = energy.data?.status === "READY" && energy.data.phase !== "UNKNOWN" ? energy.data.phase : "MAINTENANCE";
    return <Generator defaultPhase={def} onCreated={invalidate} />;
  }

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
              Mesocycle {micro!.mesoNumber}/{micro!.mesoCount} · {done ? "complete" : <>Week {micro!.week}/{micro!.weeks} <span className="tag">{micro!.isDeload ? "DELOAD" : "ACCUMULATION"}</span></>} · {meso.phase.toLowerCase()}
            </p>
          )}
        </div>
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
                <div className="mvol-bar">
                  <div className="mvol-fill" style={{ width: `${pct}%`, background: act >= tgt ? "var(--volt)" : "var(--ice)" }} />
                </div>
                <span className="mvol-sets mono" style={{ width: 46 }}>{act}/{tgt}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, margin: "0 4px 14px" }}>
        {done ? "Plan complete — add a mesocycle to continue or end the plan."
          : micro?.isDeload ? "Deload week — targets drop to ~MV; log sessions as deload (auto-marked on the Start screen)."
            : "Targets ramp MEV→ceiling across the block. The number after “/” is this week's target; before it is your last 7 days."}
      </p>

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {!done && <button className="btn btn-volt" disabled={advance.isPending} onClick={() => advance.mutate()}>Complete week →</button>}
        <button className="btn btn-ghost" disabled={addMeso.isPending}
          onClick={() => addMeso.mutate({ name: `Mesocycle ${p.mesocycles.length + 1}`, accumulationWeeks: meso?.accumulationWeeks ?? 4, phase: meso?.phase ?? "MAINTENANCE", focusMuscles: meso?.focusMuscles ?? [] })}>+ Add mesocycle</button>
        <button className="btn btn-ghost" disabled={end.isPending} onClick={() => end.mutate()}>End plan</button>
      </div>
    </main>
  );
}

function Generator({ defaultPhase, onCreated }: { defaultPhase: string; onCreated: () => void }) {
  const nav = useNavigate();
  const [name, setName] = useState("Mesocycle 1");
  const [phase, setPhase] = useState(defaultPhase);
  const [weeks, setWeeks] = useState(4);
  const [focus, setFocus] = useState<Muscle[]>([]);
  const toggle = (m: Muscle) => setFocus((f) => (f.includes(m) ? f.filter((x) => x !== m) : [...f, m]));
  const create = useMutation({
    mutationFn: () => Api.createPlan({ name: name.trim() || "Mesocycle 1", mesocycles: [{ name: name.trim() || "Mesocycle 1", accumulationWeeks: weeks, phase, focusMuscles: focus }] }),
    onSuccess: onCreated,
  });
  const meso = { name, accumulationWeeks: weeks, phase, focusMuscles: focus };

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div><h1>Build a plan</h1><p>A mesocycle of volume ramping MEV→MRV, then a deload week.</p></div>
      </div>
      <div className="card card-pad">
        <span className="micro">Mesocycle name</span>
        <input className="input mono" style={{ marginTop: 6 }} value={name} onChange={(e) => setName(e.target.value)} />

        <span className="micro" style={{ display: "block", marginTop: 16 }}>Energy phase {defaultPhase !== "MAINTENANCE" && "(from your Coach estimate)"}</span>
        <div className="seg" style={{ width: "100%", marginTop: 6 }}>
          {PHASES.map((o) => <button key={o.v} className={phase === o.v ? "on" : ""} style={{ flex: 1 }} onClick={() => setPhase(o.v)}>{o.label}</button>)}
        </div>

        <span className="micro" style={{ display: "block", marginTop: 16 }}>Accumulation weeks (+1 deload)</span>
        <div className="seg" style={{ width: "100%", marginTop: 6 }}>
          {ACCUM.map((w) => <button key={w} className={weeks === w ? "on" : ""} style={{ flex: 1 }} onClick={() => setWeeks(w)}>{w}</button>)}
        </div>

        <span className="micro" style={{ display: "block", marginTop: 16 }}>Focus muscles</span>
        <div className="chip-wrap" style={{ marginTop: 6 }}>
          {MUSCLES.map((m) => <button key={m.key} className={`chip-toggle${focus.includes(m.key) ? " on" : ""}`} onClick={() => toggle(m.key)}>{m.label}</button>)}
        </div>

        {focus.length > 0 && (
          <>
            <span className="micro" style={{ display: "block", marginTop: 16 }}>Week 1 targets (sets/week)</span>
            <div className="chip-wrap" style={{ marginTop: 6 }}>
              {focus.map((m) => <span key={m} className="chip-toggle half">{muscleLabel(m)} {targetSets(m, meso, 1)} → {targetSets(m, meso, weeks)}</span>)}
            </div>
          </>
        )}

        <button className="btn btn-volt btn-block" style={{ marginTop: 18 }} disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Start plan"}
        </button>
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => nav("/muscles")}>See current volume</button>
      </div>
    </main>
  );
}
