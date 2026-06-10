import type { MacrocycleDto, MesocycleDto, Muscle, WorkoutDto } from "./api/types";
import { LANDMARKS } from "./muscles";

/** DELOAD sessions are excluded from progression charts + the strength trajectory. */
export const isDeload = (w: WorkoutDto) => w.cyclePhase === "DELOAD";

export interface CurrentMicro {
  meso: MesocycleDto;
  mesoNumber: number;   // 1-based
  mesoCount: number;
  week: number;         // 1-based
  weeks: number;        // accumulationWeeks + 1 (deload)
  isDeload: boolean;
  completed: boolean;
}

export function currentMicro(plan: MacrocycleDto): CurrentMicro | null {
  const meso = plan.mesocycles[plan.mesoIndex];
  if (!meso) return null;
  const weeks = meso.accumulationWeeks + 1;
  return {
    meso, mesoNumber: plan.mesoIndex + 1, mesoCount: plan.mesocycles.length,
    week: plan.week, weeks, isDeload: plan.week > meso.accumulationWeeks,
    completed: plan.status === "COMPLETED",
  };
}

/** Weekly hard-set target for a muscle in a mesocycle's given week. Start at MEV, ramp to a
 *  phase-set ceiling across accumulation; deload drops to ~MV. Non-focus muscles hold at MEV. */
export function targetSets(muscle: Muscle, meso: MesocycleDto, week: number): number {
  const lm = LANDMARKS[muscle];
  const n = meso.accumulationWeeks;
  if (week > n) return Math.max(lm.mv, Math.round(lm.mev * 0.5));   // deload
  const focus = meso.focusMuscles.includes(muscle);
  if (!focus) return lm.mev;                                        // maintenance
  const ceiling = meso.phase === "SURPLUS" ? lm.mrv : meso.phase === "DEFICIT" ? lm.mav[0] : lm.mav[1];
  const w = Math.min(week, n);
  const t = n <= 1 ? ceiling : lm.mev + (ceiling - lm.mev) * (w - 1) / (n - 1);
  return Math.round(t);
}
