/**
 * COACHING EVAL HARNESS — not a unit test, an eval.
 *
 * `periodization.test.ts` samples a few hand-picked cases. This sweeps the macrocycle planner across
 * EVERY goal × days/week × duration × focus combination and SCORES how often the research-backed
 * invariants hold, printing a scorecard. The point is to catch silent rule violations (e.g. the
 * "every prime mover trained >=2x/week" rule that regressed during development) across the whole input
 * space, not just sampled points.
 *
 * Run with:  npm run eval   (kept OUT of the default `npm test` gate on purpose — an eval is a
 * measurement you run, separate from the unit suite). Track the pass-rate as the planner changes.
 */
import { describe, it, expect } from "vitest";
// The actual shipped 84-exercise default seed (backend resource) — see REAL below.
import DEFAULT_EXERCISES from "../../backend/src/main/resources/default-exercises.json";
import { blockDates, planMacrocycle, phaseMod, targetSets, type PlanPreview } from "./periodization";
import { rirWave } from "./prescription";
import { LANDMARKS, muscleLabel, trainsMuscle } from "./muscles";
import type { ExerciseDto, GoalType, Muscle } from "./api/types";

// Mirror the planner's own constants (they aren't exported).
const ALL_MUSCLES: Muscle[] = [
  "CHEST", "FRONT_DELT", "SIDE_DELT", "REAR_DELT", "LAT", "UPPER_BACK", "TRAP",
  "BICEP", "TRICEP", "FOREARM", "QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS",
];
const PRIME_MOVERS: Muscle[] = ["CHEST", "LAT", "QUAD", "HAMSTRING", "GLUTE", "SIDE_DELT", "BICEP", "TRICEP"];
const MIN_FREQ = 2;
const PER_SESSION_CAP = 5;

const ex = (id: string, name: string, muscle: Muscle): ExerciseDto => ({
  id, name, isBodyweight: false, equipment: null, category: "STRENGTH", defaultUnit: "kg",
  restSeconds: null, cardioMetrics: null, muscleContributions: [{ muscle, fraction: "1.0" }],
  laterality: null, mechanic: "COMPOUND", loadable: null,
});
// Full catalog: exactly one primary exercise per muscle ⇒ a muscle's weekly frequency == its day-count.
const FULL = ALL_MUSCLES.map((m, i) => ex(`m${i}`, `${m} lift`, m));
const exId = (m: Muscle) => FULL[ALL_MUSCLES.indexOf(m)].id;
const freqOf = (p: PlanPreview, m: Muscle) =>
  p.templates.filter((t) => t.exercises.some((e) => e.exerciseId === exId(m))).length;

// REAL catalog: the shipped 84-exercise default seed. Sweeping against this (where frequency is NOT
// frequency==day-count by construction) is what makes R7/R6 a real guarantee, not a synthetic tautology.
interface RawEx { name: string; category: string; equipment: string; isBodyweight: boolean;
  loadable: boolean; laterality: string; mechanic: string;
  muscles: { muscle: string; fraction: string }[]; }
const REAL: ExerciseDto[] = (DEFAULT_EXERCISES as RawEx[]).map((e, i) => ({
  id: `real-${i}`, name: e.name, isBodyweight: e.isBodyweight, equipment: e.equipment as ExerciseDto["equipment"],
  category: e.category, defaultUnit: "kg", restSeconds: null, cardioMetrics: null,
  muscleContributions: e.muscles as { muscle: Muscle; fraction: string }[],
  laterality: e.laterality as ExerciseDto["laterality"], mechanic: e.mechanic as ExerciseDto["mechanic"],
  loadable: e.loadable,
}));
const realById = new Map(REAL.map((e) => [e.id, e]));
// a muscle's weekly frequency under the REAL catalog = days whose picked exercises train it at the ≥0.5 basis
const freqReal = (p: PlanPreview, m: Muscle) =>
  p.templates.filter((t) => t.exercises.some((e) => {
    const rx = realById.get(e.exerciseId);
    return rx ? trainsMuscle(rx.muscleContributions, m) : false;
  })).length;

// ── the sweep ──
const GOALS: GoalType[] = ["GENERAL_HYPERTROPHY", "STRENGTH", "MUSCLE_FOCUS", "CONTEST_PREP"];
const DAYS = [2, 3, 4, 5, 6];
const DURATIONS = [6, 8, 12, 16];
const FOCI: Muscle[][] = [[], ["SIDE_DELT"], ["GLUTE", "SIDE_DELT", "BICEP"]];

interface Case { goal: GoalType; days: number; duration: number; focus: Muscle[]; }
function allCases(): Case[] {
  const out: Case[] = [];
  for (const goal of GOALS) for (const days of DAYS) for (const duration of DURATIONS) for (const focus of FOCI)
    out.push({ goal, days, duration, focus });
  return out;
}

interface Violation { rule: string; detail: string; c: Case; }

function evaluate(c: Case): Violation[] {
  const v: Violation[] = [];
  const targetDate = c.goal === "CONTEST_PREP"
    ? new Date(Date.now() + c.duration * 7 * 86_400_000).toISOString().slice(0, 10) : null;
  const p = planMacrocycle(c.goal, c.duration, targetDate, c.focus, c.days, FULL);
  const fail = (rule: string, detail: string) => v.push({ rule, detail, c });

  // R1 — produces a non-empty plan with positive duration
  if (p.mesocycles.length === 0) fail("R1-nonempty", "no mesocycles produced");
  if (p.totalWeeks <= 0) fail("R1-weeks", `totalWeeks=${p.totalWeeks}`);

  // R2 — first block is HYPERTROPHY for non-prep goals
  if (c.goal !== "CONTEST_PREP" && p.mesocycles[0]?.blockType !== "HYPERTROPHY")
    fail("R2-first-block", `first block=${p.mesocycles[0]?.blockType}, expected HYPERTROPHY`);

  // R3/R4 — contest prep ends in PEAK, every block in a DEFICIT
  if (c.goal === "CONTEST_PREP") {
    const last = p.mesocycles[p.mesocycles.length - 1];
    if (last?.blockType !== "PEAK") fail("R3-prep-peak", `ends in ${last?.blockType}, expected PEAK`);
    if (!p.mesocycles.every((b) => b.phase === "DEFICIT")) fail("R4-prep-deficit", "a block is not in a DEFICIT");
  }

  // R5/R6 — focus muscles pinned on every block AND trained >=2x
  if (c.goal === "MUSCLE_FOCUS" || c.goal === "CONTEST_PREP") {
    for (const fm of c.focus.slice(0, 3)) {
      if (!p.mesocycles.every((b) => b.focusMuscles.includes(fm))) fail("R5-focus-pinned", `${fm} not pinned on every block`);
      if (freqOf(p, fm) < MIN_FREQ) fail("R6-focus-2x", `focus ${fm} trained ${freqOf(p, fm)}x/wk`);
    }
  }

  // R7 — THE headline invariant: every prime mover is trained >=2x/week, OR the plan warns about it by name
  for (const m of PRIME_MOVERS) {
    const f = freqOf(p, m);
    if (f < MIN_FREQ) {
      const warned = p.warnings.some((w) => w.toLowerCase().includes(muscleLabel(m).toLowerCase()));
      if (!warned) fail("R7-prime-2x-or-warn", `${m} trained ${f}x/wk with NO warning`);
    }
  }

  // R8 — no single exercise exceeds the per-session set cap (junk-volume guard)
  for (const t of p.templates) for (const e of t.exercises)
    if (e.sets > PER_SESSION_CAP) fail("R8-session-cap", `${t.name}/${e.name}=${e.sets} sets > cap ${PER_SESSION_CAP}`);

  // R9 — generated prescription sanity: positive reps + targetRir within [phase floor, 3]
  const floor = phaseMod(p.mesocycles[0]?.phase).rirFloor;
  for (const t of p.templates) for (const e of t.exercises) {
    if (!(e.reps > 0)) fail("R9-reps", `${t.name}/${e.name} reps=${e.reps}`);
    const rir = parseInt(e.targetRir, 10);
    if (!Number.isInteger(rir) || rir < floor || rir > 3)
      fail("R9-rir", `${t.name}/${e.name} targetRir=${e.targetRir} (allowed ${floor}..3)`);
  }

  // R14 — the stored template targetRir equals the RIR wave's week-1 value under the same phase floor
  // (accept-time number == first logged session's seed)
  const wantRir = String(rirWave(1, p.mesocycles[0]?.accumulationWeeks ?? 4, floor));
  for (const t of p.templates) for (const e of t.exercises)
    if (e.targetRir !== wantRir) fail("R14-targetRir-wave", `${t.name}/${e.name} targetRir=${e.targetRir}, want wave wk1 ${wantRir}`);

  // R15/R16/R18/R21/R22/R23/R24 — volume ramp + bounded phase band-step, swept over ALL 15 muscles and
  // EVERY block (R23: the low-MEV muscles are where bandStep rounding + the MV floor misbehave).
  for (const b of p.mesocycles) {
    const n = b.accumulationWeeks;
    for (const m of ALL_MUSCLES) {
      const lm = LANDMARKS[m];
      // R15 — a HYPERTROPHY block ramps (not flat at the ceiling) for muscles with room above MEV
      if (b.blockType === "HYPERTROPHY" && n > 1 && targetSets(m, b, n) <= targetSets(m, b, 1) && Math.max(lm.mv, lm.mev) < lm.mrv)
        fail("R15-ramps", `${m} flat at ${targetSets(m, b, 1)} over ${n} weeks`);
      // R16 — bounded ramp rate: 0 ≤ Δ ≤ 2 sets/week
      for (let w = 2; w <= n; w++) {
        const d = targetSets(m, b, w) - targetSets(m, b, w - 1);
        if (d < 0 || d > 2) fail("R16-ramp-rate", `${m} Δwk${w}=${d}`);
      }
      // R21/R22 — every week/phase target stays within the volume landmarks [MV, MRV] (no over-MRV junk volume)
      for (let w = 1; w <= n + 1; w++) for (const phase of ["DEFICIT", "MAINTENANCE", "SURPLUS"]) {
        const t = targetSets(m, { ...b, phase }, w);
        if (t > lm.mrv) fail("R21-mrv-cap", `${m} ${phase} wk${w} = ${t} > MRV ${lm.mrv}`);
        if (t < lm.mv) fail("R22-mv-floor", `${m} ${phase} wk${w} = ${t} < MV ${lm.mv}`);
      }
      // R18 — phase is a bounded, monotone band-step: deficit ≤ maintenance ≤ surplus
      const ph = (phase: string) => targetSets(m, { ...b, phase }, n);
      if (!(ph("DEFICIT") <= ph("MAINTENANCE") && ph("MAINTENANCE") <= ph("SURPLUS")))
        fail("R18-phase-monotone", `${m} d/m/s = ${ph("DEFICIT")}/${ph("MAINTENANCE")}/${ph("SURPLUS")}`);
      // R24 — the deload week's target is phase-INDEPENDENT (its magnitude vs accumulation is a deferred
      // finding — see docs/eval-findings.md; here we only pin that energy phase can't move the deload).
      const dl = (phase: string) => targetSets(m, { ...b, phase }, n + 1);
      if (!(dl("DEFICIT") === dl("MAINTENANCE") && dl("MAINTENANCE") === dl("SURPLUS")))
        fail("R24-deload-phase-indep", `${m} deload d/m/s = ${dl("DEFICIT")}/${dl("MAINTENANCE")}/${dl("SURPLUS")}`);
    }
  }

  // R19 — phase potentiation: no STRENGTH/PEAK block before at least one HYPERTROPHY (non-prep goals)
  if (c.goal !== "CONTEST_PREP") {
    const types = p.mesocycles.map((m) => m.blockType);
    types.forEach((t, i) => {
      if ((t === "STRENGTH" || t === "PEAK") && !types.slice(0, i).includes("HYPERTROPHY"))
        fail("R19-potentiation", `${t} at block ${i} with no prior HYPERTROPHY`);
    });
  }
  // R20 — a PEAK block, when present, is the terminal mesocycle
  const peakI = p.mesocycles.findIndex((m) => m.blockType === "PEAK");
  if (peakI >= 0 && peakI !== p.mesocycles.length - 1) fail("R20-peak-terminal", `PEAK at ${peakI}/${p.mesocycles.length - 1}`);

  // R25 — measured DEFICIT clamps every recipe SURPLUS down to MAINTENANCE (never below), others unchanged.
  // (Threading the EnergyService CONFIDENCE through the clamp is a deferred decision — see docs/eval-findings.md.)
  {
    const pd = planMacrocycle(c.goal, c.duration, targetDate, c.focus, c.days, FULL, "DEFICIT");
    if (pd.mesocycles.some((m) => m.phase === "SURPLUS")) fail("R25-deficit-clamp", "a SURPLUS survived a measured DEFICIT");
    pd.mesocycles.forEach((m, i) => {
      const base = p.mesocycles[i]?.phase;
      if (base && base !== "SURPLUS" && m.phase !== base) fail("R25-deficit-clamp", `block ${i} ${base}→${m.phase} (non-SURPLUS changed)`);
    });
  }

  // R26 — the headline frequency guarantees hold against the REALISTIC default catalog, not just the synthetic one
  {
    const pr = planMacrocycle(c.goal, c.duration, targetDate, c.focus, c.days, REAL);
    for (const m of PRIME_MOVERS) {
      if (freqReal(pr, m) < MIN_FREQ) {
        const warned = pr.warnings.some((w) => w.toLowerCase().includes(muscleLabel(m).toLowerCase()));
        if (!warned) fail("R26-real-prime-2x", `${m} ${freqReal(pr, m)}×/wk on REAL catalog, no warning`);
      }
    }
    if (c.goal === "MUSCLE_FOCUS" || c.goal === "CONTEST_PREP") for (const fm of c.focus.slice(0, 3)) {
      if (freqReal(pr, fm) < MIN_FREQ) {
        const warned = pr.warnings.some((w) => w.toLowerCase().includes(muscleLabel(fm).toLowerCase()));
        if (!warned) fail("R26-real-focus-2x", `focus ${fm} ${freqReal(pr, fm)}×/wk on REAL catalog, no warning`);
      }
    }
  }

  // R28/R29/R30 — CONTEST_PREP calendar: no overshoot past the show date, exactly one terminal PEAK at
  // near-maximal intensity, contiguous blocks ending on/before the target date.
  if (c.goal === "CONTEST_PREP" && targetDate) {
    const wks = Math.round((new Date(targetDate).getTime() - Date.now()) / (7 * 86_400_000));
    if (p.totalWeeks > Math.max(2, wks)) fail("R28-no-overshoot", `totalWeeks ${p.totalWeeks} > weeks-to-show ${Math.max(2, wks)}`);
    if (p.mesocycles.filter((m) => m.blockType === "PEAK").length !== 1) fail("R28-one-peak", "not exactly one PEAK");
    const peak = p.mesocycles[p.mesocycles.length - 1];
    if (peak?.intensityBand && peak.intensityBand.repHigh > 3) fail("R30-peak-intensity", `peak repHigh ${peak.intensityBand.repHigh} > 3`);
    if (peak?.intensityBand && parseInt(peak.intensityBand.targetRir, 10) > 1) fail("R30-peak-intensity", `peak targetRir ${peak.intensityBand.targetRir} > 1`);
    const d = blockDates(new Date().toISOString(), p.mesocycles);
    if (d.length && d[d.length - 1].end.getTime() > new Date(targetDate).getTime() + 86_400_000)
      fail("R29-ends-by-date", `last block ends after the show date`);
    for (let i = 0; i < d.length - 1; i++) if (d[i].end.getTime() >= d[i + 1].start.getTime()) fail("R29-contiguous", `blocks ${i}/${i + 1} overlap`);
  }

  return v;
}

describe("coach eval — macrocycle planner invariants over a full config sweep", () => {
  // R32 — the sweep enumerates every goal × days × duration × focus, so a dropped loop dimension can't
  // make the whole eval pass vacuously.
  it("R32 — sweeps the full configuration space", () => {
    expect(allCases().length).toBe(GOALS.length * DAYS.length * DURATIONS.length * FOCI.length);
  });

  // R27 — a prime mover with zero catalog coverage is WARNED by name (no silent under-training).
  it("R27 — warns by name when a prime mover has no exercise", () => {
    const sparse = FULL.filter((e) => !e.muscleContributions.some((c) => c.muscle === "CHEST"));
    const p = planMacrocycle("GENERAL_HYPERTROPHY", 12, null, [], 4, sparse);
    expect(freqOf(p, "CHEST")).toBe(0);
    expect(p.warnings.some((w) => w.toLowerCase().includes("chest"))).toBe(true);
  });

  // R31 — DEFERRED: CONTEST_PREP with a null targetDate currently builds an unanchored PEAK silently.
  // docs/coach.md says a show date is required; pinning the intended warn/refuse behavior is a product
  // decision (see docs/eval-findings.md). Documenting current behavior so the regression is visible.
  it.skip("R31 — CONTEST_PREP without a target date should warn/refuse a peak (deferred)", () => {
    const p = planMacrocycle("CONTEST_PREP", 8, null, ["SIDE_DELT"], 4, FULL);
    expect(p.warnings.some((w) => /date|show/i.test(w)) || !p.mesocycles.some((b) => b.blockType === "PEAK")).toBe(true);
  });

  it("scores every goal × days × duration × focus combination", () => {
    const cases = allCases();
    const results = cases.map((c) => ({ c, v: evaluate(c) }));
    const violations = results.flatMap((r) => r.v);
    const passed = results.filter((r) => r.v.length === 0).length;

    const byRule: Record<string, number> = {};
    for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

    /* eslint-disable no-console */
    console.log(`\n=== COACH EVAL SCORECARD ===`);
    console.log(`configs evaluated:      ${cases.length}`);
    console.log(`configs fully passing:  ${passed}/${cases.length} (${((100 * passed) / cases.length).toFixed(1)}%)`);
    console.log(`total violations:       ${violations.length}`);
    for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}`);
    for (const v of violations.slice(0, 10))
      console.log(`  e.g. [${v.rule}] goal=${v.c.goal} days=${v.c.days} dur=${v.c.duration} focus=[${v.c.focus.join(",")}] :: ${v.detail}`);
    console.log(`============================\n`);
    /* eslint-enable no-console */

    expect(
      violations,
      `planner invariant violations (${violations.length}):\n` +
        violations.map((v) => `[${v.rule}] ${JSON.stringify(v.c)} :: ${v.detail}`).join("\n"),
    ).toHaveLength(0);
  });
});
