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

// ── energy-phase modifiers (Layer 5 ①): phase is orthogonal to blockType ──
export interface PhaseModifier { volumeMult: number; rirFloor: number; progressMult: number; }
export const PHASE_MODIFIERS: Record<string, PhaseModifier> = {
  SURPLUS:     { volumeMult: 1.05, rirFloor: 0, progressMult: 1.0 },   // push toward MRV, full progression
  MAINTENANCE: { volumeMult: 1.0,  rirFloor: 0, progressMult: 0.5 },   // slow gain
  DEFICIT:     { volumeMult: 0.85, rirFloor: 1, progressMult: 0.1 },   // toward MEV/MAV, hold loads, don't grind
};
export const phaseMod = (phase: string | null | undefined): PhaseModifier =>
  PHASE_MODIFIERS[phase ?? "MAINTENANCE"] ?? PHASE_MODIFIERS.MAINTENANCE;

/** Weekly hard-set target for a muscle in a block's given week. blockType sets the band; the energy phase
 *  scales the ceiling (SURPLUS 1.05 / MAINTENANCE 1.0 / DEFICIT 0.85). */
export function targetSets(muscle: Muscle, meso: MesocycleDto | MesoInput, week: number): number {
  const lm = LANDMARKS[muscle];
  const n = meso.accumulationWeeks;
  if (week > n) return Math.max(lm.mv, Math.round(lm.mev * 0.5));        // deload (phase-independent floor)
  const focus = meso.focusMuscles.includes(muscle);
  const bt = (meso.blockType ?? "HYPERTROPHY") as BlockType;
  const ceiling = blockCeiling(bt, lm, focus) * phaseMod(meso.phase).volumeMult;
  const start = focus && bt === "HYPERTROPHY" ? lm.mev : ceiling;       // hypertrophy ramps; others ~flat
  const w = Math.min(week, n);
  const t = n <= 1 ? ceiling : start + (ceiling - start) * (w - 1) / (n - 1);
  return Math.max(lm.mv, Math.round(t));
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

export interface PrescribedExercise { exerciseId: string; name: string; sets: number; reps: number; targetRir: string; }
export interface PlanPreview {
  mesocycles: MesoInput[];
  totalWeeks: number;
  splitName: string;
  templates: { name: string; exercises: PrescribedExercise[] }[];
  warnings: string[];
}

/**
 * Split shapes by training days/week → muscles trained each day. Designed so every prime mover is hit
 * ≥2×/week (Schoenfeld 2016: ≥2× beats 1× for hypertrophy, volume-equated): Full-Body×2–3, Upper/Lower×2
 * (4d), U/L + PPL (5d), PPL×2 (6d). 48h between training the same muscle.
 */
const SHAPES: Record<number, { name: string; muscles: Muscle[] }[]> = {
  2: [
    { name: "Full Body A", muscles: ["QUAD", "HAMSTRING", "CHEST", "LAT", "SIDE_DELT", "BICEP", "CALF"] },
    { name: "Full Body B", muscles: ["QUAD", "HAMSTRING", "CHEST", "LAT", "FRONT_DELT", "TRICEP", "ABS"] },
  ],
  3: [
    { name: "Full Body A", muscles: ["QUAD", "HAMSTRING", "CHEST", "LAT", "SIDE_DELT", "BICEP"] },
    { name: "Full Body B", muscles: ["QUAD", "GLUTE", "CHEST", "UPPER_BACK", "TRICEP", "CALF"] },
    { name: "Full Body C", muscles: ["HAMSTRING", "LAT", "FRONT_DELT", "REAR_DELT", "BICEP", "ABS"] },
  ],
  4: [
    { name: "Upper A", muscles: ["CHEST", "LAT", "SIDE_DELT", "BICEP", "TRICEP"] },
    { name: "Lower A", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF"] },
    { name: "Upper B", muscles: ["CHEST", "LAT", "UPPER_BACK", "FRONT_DELT", "REAR_DELT", "BICEP", "TRICEP"] },
    { name: "Lower B", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS"] },
  ],
  5: [
    { name: "Upper", muscles: ["CHEST", "LAT", "SIDE_DELT", "BICEP", "TRICEP"] },
    { name: "Lower", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF"] },
    { name: "Push", muscles: ["CHEST", "FRONT_DELT", "SIDE_DELT", "TRICEP"] },
    { name: "Pull", muscles: ["LAT", "UPPER_BACK", "REAR_DELT", "BICEP"] },
    { name: "Legs", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS"] },
  ],
  6: [
    { name: "Push A", muscles: ["CHEST", "FRONT_DELT", "SIDE_DELT", "TRICEP"] },
    { name: "Pull A", muscles: ["LAT", "UPPER_BACK", "REAR_DELT", "BICEP", "TRAP"] },
    { name: "Legs A", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS"] },
    { name: "Push B", muscles: ["CHEST", "SIDE_DELT", "FRONT_DELT", "TRICEP"] },
    { name: "Pull B", muscles: ["LAT", "UPPER_BACK", "REAR_DELT", "BICEP"] },
    { name: "Legs B", muscles: ["QUAD", "HAMSTRING", "GLUTE", "CALF"] },
  ],
};
const PRIME_MOVERS: Muscle[] = ["CHEST", "LAT", "QUAD", "HAMSTRING", "GLUTE", "SIDE_DELT", "BICEP", "TRICEP"];
const MIN_FREQ = 2;          // research-backed minimum sessions/week per muscle
const PER_SESSION_CAP = 5;   // productive sets/muscle/session before junk volume

const primaryFor = (ex: ExerciseDto, m: Muscle) =>
  ex.category !== "CARDIO" && ex.muscleContributions.some((c) => c.muscle === m && parseFloat(c.fraction) >= 1);

type Day = { name: string; muscles: Muscle[] };
/** Greedily order days so each is followed by the remaining day that shares the fewest muscles — keeps a
 *  muscle (and its synergists) off back-to-back days for ~48–72h recovery. */
function orderForRecovery(days: Day[]): Day[] {
  if (days.length <= 2) return days;
  const rest = [...days];
  const out: Day[] = [rest.shift()!];
  while (rest.length) {
    const prev = new Set(out[out.length - 1].muscles);
    let bestI = 0, bestShared = Infinity;
    rest.forEach((d, i) => {
      const shared = d.muscles.reduce((n, m) => n + (prev.has(m) ? 1 : 0), 0);
      if (shared < bestShared) { bestShared = shared; bestI = i; }
    });
    out.push(rest.splice(bestI, 1)[0]);
  }
  return out;
}
/** Prime movers trained on adjacent days (recovery risk) — surfaced as warnings. */
function adjacencyWarnings(days: Day[]): string[] {
  const out: string[] = [];
  for (const m of PRIME_MOVERS) {
    for (let i = 1; i < days.length; i++) {
      if (days[i].muscles.includes(m) && days[i - 1].muscles.includes(m)) {
        out.push(`${muscleLabel(m)} lands on back-to-back days (${days[i - 1].name} → ${days[i].name}) — add a rest day between them.`);
        break;
      }
    }
  }
  return out;
}

/**
 * Build a split + templates for one block. Each prime mover (and every focus muscle) is hit ≥2×/week;
 * exercise choice is goal-aware (compounds for strength) and rotates across days for variety; weekly
 * targets are spread across the muscle's sessions, capped per session.
 */
function generateSplit(block: MesoInput, daysPerWeek: number, exercises: ExerciseDto[]): Omit<PlanPreview, "mesocycles" | "totalWeeks"> {
  const base = (SHAPES[Math.min(6, Math.max(2, daysPerWeek))] ?? SHAPES[3]).map((d) => ({ name: d.name, muscles: [...d.muscles] }));

  // guarantee focus muscles reach ≥2 sessions by adding them to the days that don't already include them
  for (const fm of block.focusMuscles) {
    let f = base.filter((d) => d.muscles.includes(fm)).length;
    for (const d of base) { if (f >= MIN_FREQ) break; if (!d.muscles.includes(fm)) { d.muscles.push(fm); f++; } }
  }

  // order days so the same muscle isn't trained on back-to-back days (≥48–72h recovery)
  const days = orderForRecovery(base);

  const freq: Record<string, number> = {};
  for (const d of days) for (const m of d.muscles) freq[m] = (freq[m] ?? 0) + 1;

  // candidate exercises per muscle (goal-aware), and a rotating pointer per muscle for variety
  const candFor = (m: Muscle) => {
    let c = exercises.filter((e) => primaryFor(e, m));
    if (block.blockType === "STRENGTH" || block.blockType === "PEAK") {
      const compounds = c.filter((e) => e.mechanic === "COMPOUND");
      if (compounds.length) c = compounds;
    }
    return c;
  };
  const cand: Record<string, ExerciseDto[]> = {};
  const ptr: Record<string, number> = {};
  for (const m of new Set(days.flatMap((d) => d.muscles))) cand[m] = candFor(m as Muscle);

  // per-block prescription: target reps (range low) + RIR (band's, floored by the energy phase)
  const reps = block.intensityBand?.repLow ?? 8;
  const bandRir = parseInt((block.intensityBand?.targetRir ?? "2").split("-").pop() ?? "2", 10) || 2;
  const targetRir = String(Math.max(phaseMod(block.phase).rirFloor, bandRir));

  const missing = new Set<Muscle>();
  const templates = days.map((d) => {
    const picked = new Map<string, PrescribedExercise>();
    for (const m of d.muscles) {
      const weekly = targetSets(m, block, 1);
      if (weekly <= 0) continue;
      const list = cand[m];
      if (!list || !list.length) { missing.add(m); continue; }
      const ex = list[(ptr[m] = (ptr[m] ?? 0) + 1) % list.length];   // rotate for variety across days
      const setsPerDay = Math.min(PER_SESSION_CAP, Math.max(2, Math.round(weekly / (freq[m] || 1))));
      const cur = picked.get(ex.id);
      if (!cur) picked.set(ex.id, { exerciseId: ex.id, name: ex.name, sets: setsPerDay, reps, targetRir });
      else cur.sets = Math.min(PER_SESSION_CAP, cur.sets + setsPerDay);
    }
    return { name: d.name, exercises: [...picked.values()] };
  });

  const warnings: string[] = [...adjacencyWarnings(days)];
  for (const m of block.focusMuscles) if (missing.has(m)) warnings.push(`No exercise for focus muscle ${muscleLabel(m)} — add one to your catalog.`);
  for (const m of missing) if (!block.focusMuscles.includes(m)) warnings.push(`No exercise for ${muscleLabel(m)} — that volume is unfilled.`);
  for (const m of PRIME_MOVERS) if (!missing.has(m) && (freq[m] ?? 0) < MIN_FREQ)
    warnings.push(`${muscleLabel(m)} is trained ${freq[m] ?? 0}×/week — add a day (or a session that hits it) to reach the 2× minimum (research-backed).`);

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
