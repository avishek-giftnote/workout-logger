/**
 * PRESCRIPTION ENGINE EVAL — not a unit test, an eval.
 *
 * `prescription.test.ts` checks a few hand-picked points. This sweeps the Layer 5 engine
 * (RIR wave, double-progression load math, readiness) across its whole parameter space and SCORES the
 * research-backed invariants (R10–R12), printing a scorecard. Catches silent rule drift — e.g. a deficit
 * that prescribes a load increase, or RIR leaving its bounds — that a sampled test would miss.
 *
 * Run with:  npm run eval   (kept OUT of the default `npm test` gate on purpose).
 */
import { describe, it, expect } from "vitest";
import { rirWave, nextLoad, readiness, loadIncrement, roundInc, rpePct, progressedSeed, e1rm, topWorkingSet, workingLoad } from "./prescription";
import { phaseMod } from "./periodization";
import type { Muscle, SetDto, SetType, WorkoutDto } from "./api/types";

interface Violation { rule: string; detail: string; }
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// ── R13: rpePct is the single documented formula 100−2.5(reps−1)−5·RIR, clamped [0.40,1.0] ──
function evalRpePct(): Violation[] {
  const v: Violation[] = [];
  const ref: [number, number, number][] = [[1, 0, 1.0], [5, 2, 0.80], [8, 2, 0.725], [10, 1, 0.725], [15, 5, 0.40]];
  for (const [reps, rir, want] of ref)
    if (!approx(rpePct(reps, rir), want)) v.push({ rule: "R13-rpePct-formula", detail: `rpePct(${reps},${rir})=${rpePct(reps, rir)}, want ${want}` });
  for (let reps = 1; reps <= 15; reps++) for (let rir = 0; rir <= 5; rir++) {
    const p = rpePct(reps, rir);
    if (p < 0.40 - 1e-9 || p > 1.0 + 1e-9) v.push({ rule: "R13-clamp", detail: `rpePct(${reps},${rir})=${p} ∉ [0.40,1.0]` });
  }
  return v;
}

// ── R20: bodyweight progressedSeed climbs on reps (load stays null) ──
function evalBodyweightProgression(): Violation[] {
  const v: Violation[] = [];
  for (const [lo, hi] of [[8, 12], [5, 8]] as [number, number][]) for (const reps of [lo, hi, hi + 2]) {
    const r = progressedSeed({ weight: 0, reps, rpe: null, startedAt: "" }, lo, hi, 1.0, 2.5, true);
    if (r.load !== null) v.push({ rule: "R20-bw-no-load", detail: `bw reps=${reps} → load=${r.load}` });
    if (r.reps <= lo && reps >= lo) v.push({ rule: "R20-bw-rep-progress", detail: `bw reps=${reps} → next reps=${r.reps} (not > ${lo})` });
  }
  if (progressedSeed(null, 8, 12, 1.0, 2.5, true).reps !== 8) v.push({ rule: "R20-bw-cold", detail: "no history bw → reps≠repLow" });
  return v;
}

// ── fixtures ──
const set = (reps: number, weight = "100"): SetDto => ({
  id: "s", orderIndex: 0, setType: "WORKING", weight, loadMode: null, loadDelta: null, weightUnit: "kg",
  reps, rpe: null, note: null, estimated: null, kind: "STRENGTH",
  distanceM: null, durationS: null, gradePct: null, elevationGainM: null, cadenceSpm: null,
});
const wk = (startedAt: string, sets: SetDto[], sore: Muscle[] | null): WorkoutDto => ({
  id: "w", startedAt, durationSeconds: null, rawDurationText: null, templateId: null, cyclePhase: null,
  exercises: [{ exerciseId: "x", name: "X", position: 0, note: null, sets }], soreMuscles: sore,
  createdAt: "", updatedAt: "",
});

// ── R10: RIR wave is bounded and ramps up (non-increasing RIR) across accumulation ──
function evalRirWave(): Violation[] {
  const v: Violation[] = [];
  for (const accum of [3, 4, 5, 6]) for (const floor of [0, 1]) {
    for (let week = 1; week <= accum + 1; week++) {
      const r = rirWave(week, accum, floor);
      if (r < floor || r > 3) v.push({ rule: "R10-bounds", detail: `accum=${accum} floor=${floor} week=${week} → ${r} ∉ [${floor},3]` });
    }
    for (let week = 2; week <= accum; week++) {
      if (rirWave(week, accum, floor) > rirWave(week - 1, accum, floor))
        v.push({ rule: "R10-monotonic", detail: `accum=${accum} floor=${floor}: RIR rose from week ${week - 1} to ${week}` });
    }
  }
  return v;
}

// ── R11: double-progression law — deficit holds, non-deficit progresses correctly ──
function evalNextLoad(): Violation[] {
  const v: Violation[] = [];
  const RANGES: [number, number][] = [[8, 12], [5, 8], [3, 6]];
  for (const weight of [40, 100]) for (const [lo, hi] of RANGES)
    for (const reps of [lo - 1, hi, hi + 2]) for (const mult of [0.1, 0.5, 1.0]) for (const inc of [1.25, 2.5]) {
      const prev = { weight, reps, rpe: null, startedAt: "" };
      const r = nextLoad(prev, lo, hi, mult, inc);
      const ctx = `w=${weight} reps=${reps} range=${lo}-${hi} mult=${mult} inc=${inc}`;
      if (mult <= 0.2) {
        if (r.load == null || r.load > weight) v.push({ rule: "R11-deficit-holds", detail: `${ctx} → load=${r.load} > ${weight}` });
      } else if (reps >= hi) {
        const want = roundInc(weight + inc, inc);
        if (r.load !== want || !(r.load > weight)) v.push({ rule: "R11-top-adds-load", detail: `${ctx} → load=${r.load}, want ${want}` });
        if (r.reps !== lo) v.push({ rule: "R11-top-resets-reps", detail: `${ctx} → reps=${r.reps}, want ${lo}` });
      } else {
        if (r.load !== weight) v.push({ rule: "R11-below-holds-load", detail: `${ctx} → load=${r.load}, want ${weight}` });
        if (r.reps !== reps + 1) v.push({ rule: "R11-below-adds-rep", detail: `${ctx} → reps=${r.reps}, want ${reps + 1}` });
      }
    }
  // no history → load blank at the bottom of the range
  const none = nextLoad(null, 8, 12, 1.0, 2.5);
  if (none.load !== null || none.reps !== 8) v.push({ rule: "R11-cold-start", detail: `null prev → ${JSON.stringify(none)}` });
  return v;
}

// ── R12: readiness trims iff justified (recently sore OR short last session), always with a reason ──
function evalReadiness(): Violation[] {
  const v: Violation[] = [];
  const NOW = new Date("2026-03-10T00:00:00Z").getTime();
  const M: Muscle = "CHEST";
  const target = 8;
  const SORE = { inWindow: "2026-03-09T00:00:00Z", stale: "2026-02-25T00:00:00Z" };
  for (const soreState of ["inWindow", "stale", "absent"] as const)
    for (const lastReps of [target - 3, target, target + 2]) {
      const startedAt = soreState === "stale" ? SORE.stale : SORE.inWindow;
      const sore = soreState === "absent" ? null : [M];
      const r = readiness([wk(startedAt, [set(lastReps)], sore)], "x", M, target, NOW);
      const expect = soreState === "inWindow" || lastReps < target;
      const ctx = `sore=${soreState} lastReps=${lastReps}`;
      if (r.trim !== expect) v.push({ rule: "R12-trim-iff-justified", detail: `${ctx} → trim=${r.trim}, want ${expect}` });
      if ((r.reason != null) !== expect) v.push({ rule: "R12-reason-with-trim", detail: `${ctx} → reason=${r.reason}, trim=${r.trim}` });
    }
  return v;
}

// ── R21: readiness is strictly-prior and a sore report is superseded by a LATER working set ──
function evalReadinessSemantics(): Violation[] {
  const v: Violation[] = [];
  const NOW = new Date("2026-03-10T00:00:00Z").getTime();
  const M: Muscle = "CHEST";
  // sore reported, then the muscle is trained AGAIN (hitting target) before now → soreness superseded, no trim
  const supersede = readiness(
    [wk("2026-03-07T00:00:00Z", [set(8)], [M]), wk("2026-03-09T00:00:00Z", [set(8)], null)], "x", M, 8, NOW);
  if (supersede.trim) v.push({ rule: "R21-superseded", detail: `sore then later working set → trim=${supersede.trim}` });
  // sore with no later working set → trims
  const sore = readiness([wk("2026-03-09T00:00:00Z", [set(8)], [M])], "x", M, 8, NOW);
  if (!sore.trim || sore.reason !== "recently sore") v.push({ rule: "R21-sore-trims", detail: `sore only → ${JSON.stringify(sore)}` });
  // a future-dated session (>= now) must be ignored (strictly-prior)
  const future = readiness([wk("2026-03-11T00:00:00Z", [set(3)], [M])], "x", M, 8, NOW);
  if (future.trim) v.push({ rule: "R21-strictly-prior", detail: `future session influenced readiness` });
  return v;
}

// ── R33: e1rm is monotone non-decreasing in weight and in reps (both paths). The RPE-vs-Epley level
//    divergence is a DEFERRED finding (docs/eval-findings.md) — we pin monotonicity, not cross-path agreement. ──
function evalE1rmMonotone(): Violation[] {
  const v: Violation[] = [];
  for (const reps of [1, 3, 5, 8, 12]) for (let w = 40; w <= 200; w += 20) {
    if (e1rm(w + 20, reps) < e1rm(w, reps)) v.push({ rule: "R33-e1rm-weight-monotone", detail: `reps=${reps}: e1rm dropped from ${w} to ${w + 20} kg` });
    if (e1rm(w + 20, reps, 8) < e1rm(w, reps, 8)) v.push({ rule: "R33-e1rm-weight-monotone", detail: `reps=${reps} rpe8: e1rm dropped from ${w} to ${w + 20} kg` });
  }
  for (const w of [60, 100, 140]) for (let reps = 1; reps <= 11; reps++)
    if (e1rm(w, reps + 1) < e1rm(w, reps)) v.push({ rule: "R33-e1rm-reps-monotone", detail: `w=${w}: e1rm dropped from ${reps} to ${reps + 1} reps` });
  return v;
}

// ── R34: topWorkingSet returns the e1RM-max WORKING set of the most recent NON-deload session — never a
//    WARMUP/DROP/FAILURE set, never a deload session, null on no history. ──
const setT = (reps: number, weight: string, setType: SetType): SetDto => ({ ...set(reps, weight), setType });
const wkP = (startedAt: string, sets: SetDto[], cyclePhase: "DELOAD" | null): WorkoutDto =>
  ({ ...wk(startedAt, sets, null), cyclePhase });
function evalTopWorkingSet(): Violation[] {
  const v: Violation[] = [];
  if (topWorkingSet([], "x") !== null) v.push({ rule: "R34-no-history-null", detail: "empty history → not null" });
  // newest session has a heavy WARMUP + two WORKING sets (110 has the higher e1RM) + a DROP + a FAILURE
  const newer = wkP("2026-03-09T00:00:00Z", [
    setT(5, "200", "WARMUP"), setT(5, "100", "WORKING"), setT(5, "110", "WORKING"),
    setT(12, "90", "DROP"), setT(3, "95", "FAILURE"),
  ], null);
  const older = wkP("2026-01-01T00:00:00Z", [setT(5, "150", "WORKING")], null);
  const top = topWorkingSet([older, newer], "x");
  if (top?.weight !== 110) v.push({ rule: "R34-working-only", detail: `picked ${top?.weight}, want 110 (max-e1RM WORKING, not warmup/older)` });
  // most recent session is a DELOAD → skip it, fall back to the prior non-deload session
  const deload = wkP("2026-03-10T00:00:00Z", [setT(5, "999", "WORKING")], "DELOAD");
  const skip = topWorkingSet([older, deload], "x");
  if (skip?.weight !== 150) v.push({ rule: "R34-skip-deload", detail: `picked ${skip?.weight}, want 150 (deload session must be skipped)` });
  return v;
}

// ── R35: rpePct is monotone non-increasing in reps and in RIR across the whole grid (clamp preserves it). ──
function evalRpePctMonotone(): Violation[] {
  const v: Violation[] = [];
  for (let rir = 0; rir <= 5; rir++) for (let reps = 1; reps <= 14; reps++)
    if (rpePct(reps + 1, rir) > rpePct(reps, rir) + 1e-12) v.push({ rule: "R35-reps-monotone", detail: `rir=${rir}: rpePct rose ${reps}→${reps + 1}` });
  for (let reps = 1; reps <= 15; reps++) for (let rir = 0; rir <= 5; rir++)
    if (rpePct(reps, rir + 1) > rpePct(reps, rir) + 1e-12) v.push({ rule: "R35-rir-monotone", detail: `reps=${reps}: rpePct rose rir ${rir}→${rir + 1}` });
  return v;
}

// ── R36: workingLoad always rounds to the equipment increment (never a sub-increment load), and is ≥0. ──
function evalWorkingLoadRounding(): Violation[] {
  const v: Violation[] = [];
  for (const e of [80, 100, 137.5, 212.4]) for (const reps of [1, 5, 8, 12]) for (const rir of [0, 1, 2, 3])
    for (const inc of [1.25, 2.5]) {
      const load = workingLoad(e, reps, rir, inc);
      if (Math.abs(load / inc - Math.round(load / inc)) > 1e-9) v.push({ rule: "R36-increment", detail: `workingLoad(${e},${reps},${rir},${inc})=${load} not a multiple of ${inc}` });
      if (load < 0) v.push({ rule: "R36-nonneg", detail: `workingLoad(${e},${reps},${rir},${inc})=${load} < 0` });
    }
  return v;
}

describe("prescription engine eval — Layer 5 invariants over a full parameter sweep", () => {
  it("scores rpePct, RIR wave, double progression, bodyweight + readiness, e1rm/topSet/workingLoad (R10–R13, R20–R22, R33–R36)", () => {
    void phaseMod("MAINTENANCE"); void loadIncrement;   // keep the engine's exported surface referenced
    const violations = [
      ...evalRpePct(), ...evalRirWave(), ...evalNextLoad(),
      ...evalBodyweightProgression(), ...evalReadiness(), ...evalReadinessSemantics(),
      ...evalE1rmMonotone(), ...evalTopWorkingSet(), ...evalRpePctMonotone(), ...evalWorkingLoadRounding(),
    ];

    const byRule: Record<string, number> = {};
    for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

    /* eslint-disable no-console */
    console.log(`\n=== PRESCRIPTION ENGINE EVAL SCORECARD ===`);
    console.log(`total violations:  ${violations.length}`);
    if (violations.length === 0) console.log(`  R13 rpePct · R10 rir-wave · R11 double-progression · R20 bodyweight · R12/R21 readiness — all clear`);
    for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}`);
    for (const v of violations.slice(0, 10)) console.log(`  e.g. [${v.rule}] ${v.detail}`);
    console.log(`==========================================\n`);
    /* eslint-enable no-console */

    expect(violations, violations.map((v) => `[${v.rule}] ${v.detail}`).join("\n")).toHaveLength(0);
  });
});
