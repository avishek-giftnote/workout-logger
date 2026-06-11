import type { Muscle, MuscleContributionDto, WorkoutDto } from "./api/types";

export const MUSCLES: { key: Muscle; label: string }[] = [
  { key: "CHEST", label: "Chest" },
  { key: "LAT", label: "Lats" },
  { key: "UPPER_BACK", label: "Upper back" },
  { key: "TRAP", label: "Traps" },
  { key: "FRONT_DELT", label: "Front delts" },
  { key: "SIDE_DELT", label: "Side delts" },
  { key: "REAR_DELT", label: "Rear delts" },
  { key: "BICEP", label: "Biceps" },
  { key: "TRICEP", label: "Triceps" },
  { key: "FOREARM", label: "Forearms" },
  { key: "QUAD", label: "Quads" },
  { key: "HAMSTRING", label: "Hamstrings" },
  { key: "GLUTE", label: "Glutes" },
  { key: "CALF", label: "Calves" },
  { key: "ABS", label: "Abs" },
];
export const muscleLabel = (m: Muscle) => MUSCLES.find((x) => x.key === m)?.label ?? m;

/** Shared crediting basis: an exercise "trains" a muscle when it contributes ≥ `threshold` (default 0.5).
 *  One definition for planner frequency, recovery spacing, and the volume tally so they never disagree. */
export const TRAINS_THRESHOLD = 0.5;
export const trainsMuscle = (
  contribs: MuscleContributionDto[] | undefined, m: Muscle, threshold = TRAINS_THRESHOLD,
): boolean => (contribs ?? []).some((c) => c.muscle === m && parseFloat(c.fraction) >= threshold);

/** Weekly hard-set landmarks per muscle (MV / MEV / MAV range / MRV). See docs/coach.md. */
export interface Landmark { mv: number; mev: number; mav: [number, number]; mrv: number; }
export const LANDMARKS: Record<Muscle, Landmark> = {
  CHEST: { mv: 4, mev: 8, mav: [12, 16], mrv: 20 },
  LAT: { mv: 6, mev: 10, mav: [14, 18], mrv: 22 },
  UPPER_BACK: { mv: 4, mev: 8, mav: [12, 16], mrv: 20 },
  TRAP: { mv: 0, mev: 6, mav: [10, 16], mrv: 20 },
  FRONT_DELT: { mv: 0, mev: 0, mav: [6, 8], mrv: 12 },
  SIDE_DELT: { mv: 0, mev: 6, mav: [12, 18], mrv: 26 },
  REAR_DELT: { mv: 0, mev: 6, mav: [12, 18], mrv: 26 },
  BICEP: { mv: 4, mev: 6, mav: [10, 14], mrv: 20 },
  TRICEP: { mv: 4, mev: 6, mav: [10, 14], mrv: 18 },
  FOREARM: { mv: 0, mev: 6, mav: [10, 16], mrv: 20 },
  QUAD: { mv: 6, mev: 8, mav: [12, 16], mrv: 20 },
  HAMSTRING: { mv: 4, mev: 6, mav: [10, 14], mrv: 16 },
  GLUTE: { mv: 0, mev: 4, mav: [8, 12], mrv: 16 },
  CALF: { mv: 0, mev: 6, mav: [10, 16], mrv: 20 },
  ABS: { mv: 0, mev: 6, mav: [10, 16], mrv: 20 },
};

export type VolumeStatus = "none" | "low" | "productive" | "high" | "over";
export function statusOf(sets: number, lm: Landmark): VolumeStatus {
  if (sets <= 0) return "none";
  if (sets < lm.mev) return "low";
  if (sets <= lm.mav[1]) return "productive";
  if (sets <= lm.mrv) return "high";
  return "over";
}
export const STATUS_LABEL: Record<VolumeStatus, string> = {
  none: "none", low: "below MEV", productive: "productive", high: "high", over: "over MRV",
};
export const STATUS_COLOR: Record<VolumeStatus, string> = {
  none: "var(--muted)", low: "var(--ice)", productive: "var(--volt)", high: "#f5b945", over: "var(--ember)",
};

/** Σ (muscle fraction × working-set count) per muscle for workouts within [startMs, endMs). */
export function weeklyMuscleSets(
  workouts: WorkoutDto[],
  contribsOf: (exerciseId: string) => MuscleContributionDto[] | undefined,
  startMs: number, endMs: number,
): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const w of workouts) {
    const t = new Date(w.startedAt).getTime();
    if (t < startMs || t >= endMs) continue;
    for (const b of w.exercises) {
      const contribs = contribsOf(b.exerciseId);
      if (!contribs || !contribs.length) continue;
      let working = 0;
      for (const s of b.sets) if (s.setType === "WORKING" && s.reps) working++;
      if (!working) continue;
      for (const c of contribs) tally[c.muscle] = (tally[c.muscle] ?? 0) + working * parseFloat(c.fraction);
    }
  }
  return tally;
}
