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
import { rirWave, nextLoad, readiness, loadIncrement, roundInc } from "./prescription";
import { phaseMod } from "./periodization";
import type { Muscle, SetDto, WorkoutDto } from "./api/types";

interface Violation { rule: string; detail: string; }

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

describe("prescription engine eval — Layer 5 invariants over a full parameter sweep", () => {
  it("scores RIR wave, double progression, and readiness (R10–R12)", () => {
    void phaseMod("MAINTENANCE"); void loadIncrement;   // keep the engine's exported surface referenced
    const violations = [...evalRirWave(), ...evalNextLoad(), ...evalReadiness()];

    const byRule: Record<string, number> = {};
    for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

    /* eslint-disable no-console */
    console.log(`\n=== PRESCRIPTION ENGINE EVAL SCORECARD ===`);
    console.log(`total violations:  ${violations.length}`);
    if (violations.length === 0) console.log(`  R10 rir-wave · R11 double-progression · R12 readiness — all clear`);
    for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}`);
    for (const v of violations.slice(0, 10)) console.log(`  e.g. [${v.rule}] ${v.detail}`);
    console.log(`==========================================\n`);
    /* eslint-enable no-console */

    expect(violations, violations.map((v) => `[${v.rule}] ${v.detail}`).join("\n")).toHaveLength(0);
  });
});
