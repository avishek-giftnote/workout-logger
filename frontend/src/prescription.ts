// Prescription engine (Layer 5 ②/④): project reps / RIR / load and progress them over time.
// All pure + tested (prescription.test.ts). Reused by the planner (generateSplit) and the log screen.
import type { Muscle, WorkoutDto } from "./api/types";
import { isDeload } from "./periodization";

const DAY_MS = 86_400_000;

/** Fraction of 1RM for a set of `reps` left with `rir` in reserve — RTS/Tuchscherer table as a linear rule:
 *  one rep ≈ 2.5%, one RIR ≈ 5%. Accurate ~reps ≤ 12, near failure; clamped [0.40, 1.0]. */
export function rpePct(reps: number, rir: number): number {
  const pct = 100 - 2.5 * (reps - 1) - 5 * rir;
  return Math.min(100, Math.max(40, pct)) / 100;
}

/** Estimated 1RM. RPE-adjusted when an RPE was logged (reps in reserve ⇒ more in the tank ⇒ a higher,
 *  more accurate estimate), else plain Epley as a conservative fallback that assumes the set was near
 *  failure. The two paths intentionally differ: logging an RPE REFINES the estimate (and the prescription)
 *  upward — that shift is information, not noise. See docs/eval-findings.md (D5). */
export function e1rm(weight: number, reps: number, rpe?: number | null): number {
  if (rpe != null && rpe > 0) return weight / rpePct(reps, Math.max(0, 10 - rpe));
  return weight * (1 + reps / 30);   // Epley
}

export const roundInc = (x: number, inc: number): number => inc * Math.round(x / inc);
/** Load step / rounding grain — finer for isolation (microloading), 2.5 kg for compounds. */
export const loadIncrement = (ex: { mechanic?: string | null } | null | undefined): number =>
  ex?.mechanic === "ISOLATION" ? 1.25 : 2.5;

/** Working load for a target reps × RIR given an estimated 1RM, rounded to the equipment increment. */
export const workingLoad = (e1rmKg: number, reps: number, rir: number, increment: number): number =>
  roundInc(e1rmKg * rpePct(reps, rir), increment);

export interface TopSet { weight: number; reps: number; rpe: number | null; startedAt: string; }

/** The most recent non-deload session's heaviest WORKING set for an exercise (by e1RM), or null. */
export function topWorkingSet(workouts: WorkoutDto[], exerciseId: string): TopSet | null {
  const session = workouts
    .filter((w) => !isDeload(w) && w.exercises.some((b) => b.exerciseId === exerciseId))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!session) return null;
  const block = session.exercises.find((b) => b.exerciseId === exerciseId)!;
  let best: TopSet | null = null;
  for (const s of block.sets) {
    if (s.setType !== "WORKING" || !s.weight || s.reps == null) continue;
    const cand: TopSet = { weight: parseFloat(s.weight), reps: s.reps, rpe: s.rpe ?? null, startedAt: session.startedAt };
    if (!best || e1rm(cand.weight, cand.reps, cand.rpe) > e1rm(best.weight, best.reps, best.rpe)) best = cand;
  }
  return best;
}

/** Effort wave across a mesocycle: RIR ramps 3 → 0 over the accumulation weeks (deload week = easy),
 *  floored by the energy phase (a deficit never grinds below 1 RIR). */
export function rirWave(week: number, accumWeeks: number, floor: number): number {
  if (week > accumWeeks) return Math.max(floor, 3);                       // deload week
  const t = accumWeeks <= 1 ? 1 : (Math.min(week, accumWeeks) - 1) / (accumWeeks - 1);
  return Math.max(floor, Math.round(3 + (0 - 3) * t));                    // 3 → 0
}

export interface Readiness { trim: boolean; reason: string | null; }
/** Should the upcoming session for `muscle`/exercise be eased? Considers only STRICTLY-PRIOR sessions: a
 *  soreness report (within `soreWindowDays`) eases the next session — but only if it isn't superseded by a
 *  later working set for the exercise (training it again means it had recovered). Else, a last-session
 *  rep shortfall eases it. */
export function readiness(
  workouts: WorkoutDto[], exerciseId: string, muscle: Muscle, targetReps: number, nowMs: number, soreWindowDays = 3,
): Readiness {
  const prior = workouts.filter((w) => new Date(w.startedAt).getTime() < nowMs);
  const top = topWorkingSet(prior, exerciseId);
  const topMs = top ? new Date(top.startedAt).getTime() : -Infinity;
  let lastSoreMs = -Infinity;
  for (const w of prior) {
    const ms = new Date(w.startedAt).getTime();
    if (w.soreMuscles?.includes(muscle) && nowMs - ms <= soreWindowDays * DAY_MS) lastSoreMs = Math.max(lastSoreMs, ms);
  }
  if (lastSoreMs > -Infinity && lastSoreMs >= topMs) return { trim: true, reason: "recently sore" };
  if (top && top.reps < targetReps) return { trim: true, reason: "last session fell short" };
  return { trim: false, reason: null };
}

/** Double progression, phase-scaled by `progressMult`:
 *   • surplus (mult 1.0) → add a load increment as soon as you hit the top of the range, reset reps;
 *   • maintenance (0.2 < mult < 1.0) → "slow gain": beat the top of the range by ONE extra rep before
 *     loading (an extra session at the top), so load climbs slower than in a surplus;
 *   • deficit (mult ≤ 0.2) → hold the load entirely, just reset reps at the top.
 *  Below the load threshold → hold load, add a rep. No history → null load (filled on first log). */
export function nextLoad(
  prev: TopSet | null, repLow: number, repHigh: number, progressMult: number, increment: number,
): { load: number | null; reps: number } {
  if (!prev) return { load: null, reps: repLow };
  const deficit = progressMult <= 0.2;
  const slow = !deficit && progressMult < 1.0;                  // maintenance: slow gain
  const loadAt = slow ? repHigh + 1 : repHigh;                  // reps needed before a load bump
  if (prev.reps >= loadAt) {
    const add = deficit ? 0 : increment;                        // surplus/maintenance step up; deficit holds
    return { load: roundInc(prev.weight + add, increment), reps: repLow };
  }
  return { load: prev.weight, reps: Math.min(loadAt, prev.reps + 1) };
}

/** Seed the next prescription. External-load exercises use double progression (nextLoad). Bodyweight
 *  exercises progress on REPS only (load is logged as an added/assist delta on the day), climbing past the
 *  range until the lifter chooses to add weight.
 *
 *  Block-transition guard: if `prevRepHigh` is provided and differs from `repHigh`, the rep range has
 *  changed (e.g. HYPERTROPHY → STRENGTH). In that case the double-progression gate is skipped entirely —
 *  the load is re-anchored to an e1RM-derived estimate for the new rep target using `workingLoad`. This
 *  prevents a spurious bump when hypertrophy reps (≤ 15) always exceed a strength block's repHigh (≤ 6). */
export function progressedSeed(
  prev: TopSet | null, repLow: number, repHigh: number, progressMult: number, increment: number, isBodyweight: boolean,
  prevRepHigh?: number,
): { load: number | null; reps: number } {
  if (isBodyweight) return { load: null, reps: prev ? prev.reps + 1 : repLow };
  // Block transition detected: prev rep range differs from current → anchor to e1RM, skip double progression.
  if (prev && prevRepHigh != null && prevRepHigh !== repHigh) {
    const est = e1rm(prev.weight, prev.reps, prev.rpe);
    return { load: workingLoad(est, repLow, 2, increment), reps: repLow };
  }
  return nextLoad(prev, repLow, repHigh, progressMult, increment);
}
