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
import { planMacrocycle, type PlanPreview } from "./periodization";
import { muscleLabel } from "./muscles";
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
    if (p.mesocycles.at(-1)?.blockType !== "PEAK") fail("R3-prep-peak", `ends in ${p.mesocycles.at(-1)?.blockType}, expected PEAK`);
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

  return v;
}

describe("coach eval — macrocycle planner invariants over a full config sweep", () => {
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
