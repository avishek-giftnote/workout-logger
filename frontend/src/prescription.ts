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

/** Estimated 1RM. RPE-adjusted when an RPE was logged (discounts a non-failure set), else Epley. */
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
/** Should the upcoming session for `muscle`/exercise be eased? True if the muscle was reported sore within
 *  `soreWindowDays`, or the last logged session for the exercise fell short of the target reps. */
export function readiness(
  workouts: WorkoutDto[], exerciseId: string, muscle: Muscle, targetReps: number, nowMs: number, soreWindowDays = 3,
): Readiness {
  for (const w of workouts) {
    if (w.soreMuscles?.includes(muscle) && nowMs - new Date(w.startedAt).getTime() <= soreWindowDays * DAY_MS) {
      return { trim: true, reason: "recently sore" };
    }
  }
  const top = topWorkingSet(workouts, exerciseId);
  if (top && top.reps < targetReps) return { trim: true, reason: "last session fell short" };
  return { trim: false, reason: null };
}

/** Double progression: at the top of the range → add a load increment (held in a deficit) and reset reps;
 *  below the top → hold load, add a rep. No history → null load (filled on first log) at the bottom. */
export function nextLoad(
  prev: TopSet | null, repLow: number, repHigh: number, progressMult: number, increment: number,
): { load: number | null; reps: number } {
  if (!prev) return { load: null, reps: repLow };
  if (prev.reps >= repHigh) {
    const add = progressMult <= 0.2 ? 0 : increment;            // deficit holds the load
    return { load: roundInc(prev.weight + add, increment), reps: repLow };
  }
  return { load: prev.weight, reps: Math.min(repHigh, prev.reps + 1) };
}
