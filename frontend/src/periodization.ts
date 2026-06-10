import type { BlockType, ExerciseDto, GoalType, IntensityBand, MacrocycleDto, MesoInput, MesocycleDto, Muscle, WorkoutDto } from "./api/types";
import { LANDMARKS, MUSCLES, muscleLabel, type Landmark } from "./muscles";

/** DELOAD sessions are excluded from progression charts + the strength trajectory. */
export const isDeload = (w: WorkoutDto) => w.cyclePhase === "DELOAD";

export interface CurrentMicro {
  meso: MesocycleDto; mesoNumber: number; mesoCount: number;
  week: number; weeks: number; isDeload: boolean; completed: boolean;
}
export function currentMicro(plan: MacrocycleDto): CurrentMicro | null {
  const meso = plan.mesocycles[plan.mesoIndex];
  if (!meso) return null;
  return {
    meso, mesoNumber: plan.mesoIndex + 1, mesoCount: plan.mesocycles.length,
    week: plan.week, weeks: meso.accumulationWeeks + 1, isDeload: plan.week > meso.accumulationWeeks,
    completed: plan.status === "COMPLETED",
  };
}

// ── block type → volume band + rep prescription (orthogonal to energy phase; see docs/coach.md Layer 4) ──
export const BLOCK_INTENSITY: Record<BlockType, IntensityBand> = {
  HYPERTROPHY: { repLow: 8, repHigh: 15, targetRir: "1-2", pctLow: "0.65", pctHigh: "0.75" },
  STRENGTH: { repLow: 3, repHigh: 6, targetRir: "1-2", pctLow: "0.80", pctHigh: "0.90" },
  PEAK: { repLow: 1, repHigh: 3, targetRir: "0-1", pctLow: "0.90", pctHigh: "1.00" },
  RESENSITIZATION: { repLow: 8, repHigh: 12, targetRir: "3-4", pctLow: "0.50", pctHigh: "0.60" },
  MAINTENANCE: { repLow: 6, repHigh: 10, targetRir: "2-3", pctLow: "0.70", pctHigh: "0.80" },
  PREP: { repLow: 8, repHigh: 15, targetRir: "1-2", pctLow: "0.65", pctHigh: "0.75" },
};
export const blockLabel = (b: BlockType | null | undefined): string =>
  ({ HYPERTROPHY: "Hypertrophy", STRENGTH: "Strength", PEAK: "Peak", RESENSITIZATION: "Resensitize", MAINTENANCE: "Maintenance", PREP: "Prep" } as Record<string, string>)[b ?? "HYPERTROPHY"] ?? "Block";

function blockCeiling(bt: BlockType, lm: Landmark, focus: boolean): number {
  switch (bt) {
    case "STRENGTH": return focus ? lm.mav[0] : Math.max(lm.mv, Math.round(lm.mev * 0.6));
    case "PEAK": return lm.mv;
    case "RESENSITIZATION":
    case "MAINTENANCE": return lm.mv;
    case "PREP": return focus ? lm.mav[0] : lm.mev;
    default: return focus ? lm.mrv : lm.mev;   // HYPERTROPHY
  }
}

/** Weekly hard-set target for a muscle in a block's given week. blockType sets the band; DEFICIT trims it. */
export function targetSets(muscle: Muscle, meso: MesocycleDto | MesoInput, week: number): number {
  const lm = LANDMARKS[muscle];
  const n = meso.accumulationWeeks;
  if (week > n) return Math.max(lm.mv, Math.round(lm.mev * 0.5));        // deload
  const focus = meso.focusMuscles.includes(muscle);
  const bt = (meso.blockType ?? "HYPERTROPHY") as BlockType;
  const ceiling = blockCeiling(bt, lm, focus);
  const start = focus && bt === "HYPERTROPHY" ? lm.mev : ceiling;       // hypertrophy ramps; others ~flat
  const w = Math.min(week, n);
  let t = n <= 1 ? ceiling : start + (ceiling - start) * (w - 1) / (n - 1);
  if (meso.phase === "DEFICIT") t = Math.max(Math.round(lm.mev * 0.8), Math.round(t * 0.8));   // deficit trim
  return Math.round(t);
}

// ── macrocycle planner ──
const DAY = 86_400_000;
type Spec = { blockType: BlockType; accum: number; phase: string };

function recipeUnit(goal: GoalType): Spec[] {
  switch (goal) {
    case "STRENGTH": return [
      { blockType: "HYPERTROPHY", accum: 4, phase: "SURPLUS" },
      { blockType: "STRENGTH", accum: 4, phase: "MAINTENANCE" },
      { blockType: "STRENGTH", accum: 3, phase: "MAINTENANCE" },
    ];
    case "GENERAL_HYPERTROPHY":
    case "MUSCLE_FOCUS":
    default: return [
      { blockType: "HYPERTROPHY", accum: 4, phase: "SURPLUS" },
      { blockType: "HYPERTROPHY", accum: 4, phase: "SURPLUS" },
      { blockType: "STRENGTH", accum: 3, phase: "MAINTENANCE" },   // periodic resensitization / intensification
    ];
  }
}

function mkBlock(spec: Spec, focus: Muscle[], n: number): MesoInput {
  const label = blockLabel(spec.blockType);
  const tag = focus.length ? ` (${focus.map(muscleLabel).join("/")})` : "";
  return {
    name: `${label} ${n}${tag}`, accumulationWeeks: spec.accum, phase: spec.phase,
    focusMuscles: focus, blockType: spec.blockType, intensityBand: BLOCK_INTENSITY[spec.blockType],
  };
}

export interface PlanPreview {
  mesocycles: MesoInput[];
  totalWeeks: number;
  splitName: string;
  templates: { name: string; exercises: { exerciseId: string; name: string; sets: number }[] }[];
  warnings: string[];
}

/** Split shapes by training days/week → muscles trained each day. */
const SHAPES: Record<number, { name: string; muscles: Muscle[] }[]> = {
  2: [
    { name: "Full Body A", muscles: ["CHEST", "LAT", "QUAD", "SIDE_DELT", "BICEP", "CALF"] },
    { name: "Full Body B", muscles: ["UPPER_BACK", "HAMSTRING", "GLUTE", "FRONT_DELT", "TRICEP", "ABS"] },
  ],
  3: [
    { name: "Push", muscles: ["CHEST", "FRONT_DELT", "SIDE_DELT", "TRICEP"] },
    { name: "Pull", muscles: ["LAT", "UPPER_BACK", "REAR_DELT", "BICEP", "TRAP"] },
    { name: "Legs", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS"] },
  ],
  4: [
    { name: "Upper A", muscles: ["CHEST", "LAT", "SIDE_DELT", "BICEP", "TRICEP"] },
    { name: "Lower A", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF"] },
    { name: "Upper B", muscles: ["UPPER_BACK", "FRONT_DELT", "REAR_DELT", "TRICEP", "BICEP"] },
    { name: "Lower B", muscles: ["HAMSTRING", "QUAD", "GLUTE", "CALF", "ABS"] },
  ],
};
SHAPES[5] = [...SHAPES[3], SHAPES[4][0], SHAPES[4][1]];
SHAPES[6] = [...SHAPES[3], ...SHAPES[3].map((d) => ({ name: d.name + " B", muscles: d.muscles }))];

const primaryFor = (ex: ExerciseDto, m: Muscle) =>
  ex.category !== "CARDIO" && ex.muscleContributions.some((c) => c.muscle === m && parseFloat(c.fraction) >= 1);

/** Build a split + templates for one block: pick catalog exercises per muscle to hit the week-1 targets. */
function generateSplit(block: MesoInput, daysPerWeek: number, exercises: ExerciseDto[]): Omit<PlanPreview, "mesocycles" | "totalWeeks"> {
  const days = SHAPES[Math.min(6, Math.max(2, daysPerWeek))] ?? SHAPES[3];
  const freq: Record<string, number> = {};
  for (const d of days) for (const m of d.muscles) freq[m] = (freq[m] ?? 0) + 1;

  const warnings: string[] = [];
  const missing = new Set<Muscle>();
  const templates = days.map((d) => {
    const picked = new Map<string, { exerciseId: string; name: string; sets: number }>();
    for (const m of d.muscles) {
      const weekly = targetSets(m, block, 1);
      if (weekly <= 0) continue;
      const ex = exercises.find((e) => primaryFor(e, m));
      if (!ex) { missing.add(m); continue; }
      const setsPerDay = Math.min(6, Math.max(2, Math.round(weekly / (freq[m] || 1))));
      const cur = picked.get(ex.id);
      if (!cur || setsPerDay > cur.sets) picked.set(ex.id, { exerciseId: ex.id, name: ex.name, sets: setsPerDay });
    }
    return { name: d.name, exercises: [...picked.values()] };
  });

  // coverage warnings — focus muscles first, then any prescribed muscle with no catalog exercise
  for (const m of block.focusMuscles) if (missing.has(m)) warnings.push(`No exercise for focus muscle ${muscleLabel(m)} — add one to your catalog.`);
  for (const m of missing) if (!block.focusMuscles.includes(m)) warnings.push(`No exercise for ${muscleLabel(m)} — that volume is unfilled.`);

  return { splitName: `${blockLabel(block.blockType)} split`, templates, warnings };
}

/**
 * Plan a macrocycle: a sequence of mesocycle blocks (whole macro) + a split/templates for the FIRST block.
 * Backward from targetDate when present; the same function computes preview and accept payload.
 */
export function planMacrocycle(
  goal: GoalType, durationWeeks: number, targetDate: string | null,
  focusMuscles: Muscle[], daysPerWeek: number, exercises: ExerciseDto[],
): PlanPreview {
  let total = Math.max(5, durationWeeks);
  if (targetDate) {
    const wks = Math.round((new Date(targetDate).getTime() - Date.now()) / (7 * DAY));
    if (wks > 0) total = Math.max(2, wks);
  }
  const focus = (goal === "MUSCLE_FOCUS" || goal === "CONTEST_PREP") ? focusMuscles.slice(0, 3) : [];
  const blocks: MesoInput[] = [];
  let used = 0;

  if (goal === "CONTEST_PREP") {
    const prepWeeks = Math.max(0, total - 2);                    // reserve 2 weeks for the peak block
    let i = 0;
    while (used < prepWeeks) {
      const accum = Math.min(4, Math.max(3, prepWeeks - used - 1));
      blocks.push(mkBlock({ blockType: "PREP", accum, phase: "DEFICIT" }, focus, blocks.length + 1));
      used += accum + 1; i++;
      if (i > 12) break;
    }
    blocks.push(mkBlock({ blockType: "PEAK", accum: 1, phase: "DEFICIT" }, focus, blocks.length + 1));
    used += 2;
  } else {
    const unit = recipeUnit(goal);
    let i = 0;
    while (used < total) {
      const spec = unit[i % unit.length];
      const weeks = spec.accum + 1;
      if (used > 0 && used + weeks > total + 2) break;
      blocks.push(mkBlock(spec, focus, blocks.length + 1));
      used += weeks; i++;
      if (i > 40) break;
    }
    if (blocks.length === 0) blocks.push(mkBlock(unit[0], focus, 1)), used += unit[0].accum + 1;
  }

  const split = generateSplit(blocks[0], daysPerWeek, exercises);
  return { mesocycles: blocks, totalWeeks: used, ...split };
}

/** Per-block calendar dates from a plan's startedAt (for the timeline view). */
export function blockDates(startedAt: string, mesocycles: { accumulationWeeks: number }[]): { start: Date; end: Date }[] {
  let cursor = new Date(startedAt).getTime();
  return mesocycles.map((m) => {
    const weeks = m.accumulationWeeks + 1;
    const start = new Date(cursor);
    cursor += weeks * 7 * DAY;
    return { start, end: new Date(cursor - DAY) };
  });
}
export const MUSCLE_KEYS = MUSCLES.map((m) => m.key);
