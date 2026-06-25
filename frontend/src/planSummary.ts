// Pure plan-completion summary. No React, no side-effects.
// Reuses e1rm + topWorkingSet from prescription.ts and isDeload from periodization.ts.
import type { BodyweightEntryDto, ExerciseDto, MacrocycleDto, WorkoutDto } from "./api/types";
import { isDeload } from "./periodization";
import { e1rm } from "./prescription";

export interface StrengthGain {
  exerciseName: string;
  fromKg: number;
  toKg: number;
  pct: number;
}

export interface PlanSummary {
  /** Total training weeks: sum over mesocycles of (accumulationWeeks + 1) */
  weeks: number;
  /** Number of mesocycles */
  blocks: number;
  /** Workouts whose startedAt falls within the plan window */
  sessions: number;
  /** Non-warmup working sets from non-deload in-window sessions */
  hardSets: number;
  /** Distinct in-window DELOAD sessions */
  deloads: number;
  /** Top-5 strength gains by pct, computed from first vs last non-deload session per exercise */
  strengthGains: StrengthGain[];
  /** last weigh-in weightKg minus first weigh-in weightKg within the window; null if <2 */
  bodyweightDeltaKg: number | null;
  startedAt: string;
  /** plan.completedAt ?? plan.endedAt ?? latest in-window workout startedAt */
  endedAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Best e1RM from the WORKING sets of a single exercise block in one session. */
function bestE1rmInSession(
  workout: WorkoutDto,
  exerciseName: string,
): number | null {
  const block = workout.exercises.find((b) => b.name === exerciseName);
  if (!block) return null;
  let best: number | null = null;
  for (const s of block.sets) {
    if (s.setType !== "WORKING" || !s.weight || s.reps == null) continue;
    const w = parseFloat(s.weight);
    if (!isFinite(w) || w <= 0) continue;
    const est = e1rm(w, s.reps, s.rpe);
    if (best === null || est > best) best = est;
  }
  return best;
}

// ── public API ────────────────────────────────────────────────────────────────

export function summarizePlan(
  plan: MacrocycleDto,
  workouts: WorkoutDto[],
  _exercises: ExerciseDto[],
  bodyweight: BodyweightEntryDto[],
): PlanSummary {
  // ── 1. Structural stats ───────────────────────────────────────────────────
  const weeks = plan.mesocycles.reduce((sum, m) => sum + m.accumulationWeeks + 1, 0);
  const blocks = plan.mesocycles.length;

  // ── 2. Window bounds ─────────────────────────────────────────────────────
  const windowStart = plan.startedAt;
  const windowEnd: string | null = plan.completedAt ?? plan.endedAt ?? null;

  const inWindow = (dateStr: string): boolean => {
    if (dateStr < windowStart) return false;
    if (windowEnd !== null && dateStr > windowEnd) return false;
    return true;
  };

  // ── 3. Filter workouts into window ────────────────────────────────────────
  const windowWorkouts = workouts.filter((w) => inWindow(w.startedAt));

  // Derive endedAt fallback from latest in-window workout
  let latestInWindowDate = windowStart;
  for (const w of windowWorkouts) {
    if (w.startedAt > latestInWindowDate) latestInWindowDate = w.startedAt;
  }
  const endedAt = plan.completedAt ?? plan.endedAt ?? latestInWindowDate;

  // ── 4. Session counts ─────────────────────────────────────────────────────
  const sessions = windowWorkouts.length;
  const deloadWorkouts = windowWorkouts.filter((w) => isDeload(w));
  const deloads = deloadWorkouts.length;
  const workingWorkouts = windowWorkouts.filter((w) => !isDeload(w));

  // ── 5. Hard sets (non-warmup WORKING sets, non-deload sessions) ───────────
  let hardSets = 0;
  for (const workout of workingWorkouts) {
    for (const block of workout.exercises) {
      for (const s of block.sets) {
        if (s.setType === "WORKING") hardSets++;
      }
    }
  }

  // ── 6. Strength gains ─────────────────────────────────────────────────────
  // Collect all distinct exercise names across non-deload in-window sessions
  const exerciseNames = new Set<string>();
  for (const workout of workingWorkouts) {
    for (const block of workout.exercises) {
      exerciseNames.add(block.name);
    }
  }

  const strengthGains: StrengthGain[] = [];

  for (const exerciseName of exerciseNames) {
    // Find all non-deload sessions that include this exercise, sorted ascending
    const sessionsWithExercise = workingWorkouts
      .filter((w) => w.exercises.some((b) => b.name === exerciseName))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    if (sessionsWithExercise.length < 2) continue;

    const firstSession = sessionsWithExercise[0];
    const lastSession = sessionsWithExercise[sessionsWithExercise.length - 1];

    const fromE1rm = bestE1rmInSession(firstSession, exerciseName);
    const toE1rm = bestE1rmInSession(lastSession, exerciseName);

    if (fromE1rm === null || toE1rm === null || fromE1rm <= 0) continue;

    const fromKg = Math.round(fromE1rm * 10) / 10;
    const toKg = Math.round(toE1rm * 10) / 10;
    const pct = Math.round(((toE1rm - fromE1rm) / fromE1rm) * 100);

    strengthGains.push({ exerciseName, fromKg, toKg, pct });
  }

  // Sort by pct descending, take top 5
  strengthGains.sort((a, b) => b.pct - a.pct);
  const topGains = strengthGains.slice(0, 5);

  // ── 7. Bodyweight delta ───────────────────────────────────────────────────
  const windowWeighIns = bodyweight
    .filter((b) => b.weightKg !== null && inWindow(b.recordedAt))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  let bodyweightDeltaKg: number | null = null;
  if (windowWeighIns.length >= 2) {
    const firstKg = parseFloat(windowWeighIns[0].weightKg!);
    const lastKg = parseFloat(windowWeighIns[windowWeighIns.length - 1].weightKg!);
    if (isFinite(firstKg) && isFinite(lastKg)) {
      bodyweightDeltaKg = Math.round((lastKg - firstKg) * 10) / 10;
    }
  }

  return {
    weeks,
    blocks,
    sessions,
    hardSets,
    deloads,
    strengthGains: topGains,
    bodyweightDeltaKg,
    startedAt: plan.startedAt,
    endedAt,
  };
}
