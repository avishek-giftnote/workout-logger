import type { BlockType, ExerciseDto, GoalType, IntensityBand, MacrocycleDto, MesoInput, MesocycleDto, Muscle, WorkoutDto } from "./api/types";
import { LANDMARKS, MUSCLES, TRAINS_THRESHOLD, muscleLabel, trainsMuscle, type Landmark } from "./muscles";

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

/** End-of-block volume ceiling per muscle. HYPERTROPHY: focus → MRV, others → MAV-high (so non-focus
 *  muscles still progress, not sit flat at MEV). */
function blockCeiling(bt: BlockType, lm: Landmark, focus: boolean): number {
  switch (bt) {
    case "STRENGTH": return focus ? lm.mav[0] : Math.max(lm.mv, Math.round(lm.mev * 0.6));
    case "PEAK": return lm.mv;
    case "RESENSITIZATION":
    case "MAINTENANCE": return lm.mv;
    case "PREP": return focus ? lm.mav[0] : lm.mev;
    default: return focus ? lm.mrv : lm.mav[1];   // HYPERTROPHY
  }
}

const RAMP_PER_WEEK = 2;   // ~+2 hard sets/muscle/week (RP) — bounded overload rate, not a fit to week n

// ── energy-phase modifiers (Layer 5 ①): phase ⟂ blockType. Volume is a BOUNDED band-step (~±15% of the
//    MAV−MEV span), not a multiplicative scale of the ceiling; rirFloor + progressMult drive load/effort. ──
export interface PhaseModifier { volumeBandSign: number; rirFloor: number; progressMult: number; }
export const PHASE_MODIFIERS: Record<string, PhaseModifier> = {
  SURPLUS:     { volumeBandSign: +1, rirFloor: 0, progressMult: 1.0 },   // +one band-step, full progression
  MAINTENANCE: { volumeBandSign: 0,  rirFloor: 0, progressMult: 0.5 },   // slow gain
  DEFICIT:     { volumeBandSign: -1, rirFloor: 1, progressMult: 0.1 },   // −one band-step, hold loads, don't grind
};
export const phaseMod = (phase: string | null | undefined): PhaseModifier =>
  PHASE_MODIFIERS[phase ?? "MAINTENANCE"] ?? PHASE_MODIFIERS.MAINTENANCE;

const bandStep = (lm: Landmark) => Math.round(0.15 * (lm.mav[1] - lm.mev));   // ~±15% of the MAV−MEV span

/** Weekly hard-set target for a muscle in a block's given week. Every trained muscle starts at MEV and ramps
 *  ~+2 sets/week toward the blockType ceiling; the energy phase shifts that by ±one bounded band-step. */
export function targetSets(muscle: Muscle, meso: MesocycleDto | MesoInput, week: number): number {
  const lm = LANDMARKS[muscle];
  const n = meso.accumulationWeeks;
  if (week > n) return Math.max(lm.mv, Math.round(lm.mev * 0.5));        // deload (phase-independent floor)
  const focus = meso.focusMuscles.includes(muscle);
  const bt = (meso.blockType ?? "HYPERTROPHY") as BlockType;
  const ceiling = blockCeiling(bt, lm, focus);
  const start = Math.min(Math.max(lm.mv, lm.mev), ceiling);             // start at MEV (unless ceiling is lower)
  const ramp = start + RAMP_PER_WEEK * (Math.min(week, n) - 1);
  const stepped = ramp + bandStep(lm) * phaseMod(meso.phase).volumeBandSign;
  // A focus muscle is trimmed only TOWARD MEV, never below it (don't lose the muscle you're specializing in
  // during a deficit) — floor it at MEV, capped by the block ceiling so a low-volume PEAK still holds. Non-
  // focus floors at MV. (council D2 / docs/coach.md)
  const floor = focus ? Math.min(ceiling, Math.max(lm.mv, lm.mev)) : lm.mv;
  // Clamp the band-stepped value to the ceiling (≤ MRV) — applying the band-step AFTER the clamp let a
  // SURPLUS week escape the ceiling toward over-MRV junk volume. (council R21)
  return Math.max(floor, Math.min(ceiling, stepped));
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

/** Don't prescribe a SURPLUS (extra volume + faster progression) while the Coach measures a sustained
 *  DEFICIT — downgrade to MAINTENANCE. Goal stays aspirational otherwise. */
function clampPhase(phase: string, measured: string | null | undefined): string {
  return measured === "DEFICIT" && phase === "SURPLUS" ? "MAINTENANCE" : phase;
}

function mkBlock(spec: Spec, focus: Muscle[], n: number, measured?: string | null): MesoInput {
  const label = blockLabel(spec.blockType);
  const tag = focus.length ? ` (${focus.map(muscleLabel).join("/")})` : "";
  return {
    name: `${label} ${n}${tag}`, accumulationWeeks: spec.accum, phase: clampPhase(spec.phase, measured),
    focusMuscles: focus, blockType: spec.blockType, intensityBand: BLOCK_INTENSITY[spec.blockType],
  };
}

/** A boilerplate slot the planner emits: a muscle-group placeholder with a prescription and a RECOMMENDED
 *  default exercise the user can swap (in PlanPage) for any catalog exercise that trains the same muscle.
 *  `exerciseId`/`name` are null only when the catalog has no exercise for the muscle (a true gap). */
export interface PlanSlot { muscle: Muscle; sets: number; reps: number; targetRir: string; exerciseId: string | null; name: string | null; }
export interface PlanTemplate { name: string; slots: PlanSlot[]; }
export interface PlanPreview {
  mesocycles: MesoInput[];
  totalWeeks: number;
  splitName: string;
  templates: PlanTemplate[];
  warnings: string[];
  /** Weekday slot (0=Mon…6=Sun) assigned to each template; unused slots are rest days. Aligned to `templates`. */
  schedule: number[];
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
export const PER_SESSION_CAP = 5;   // productive sets/muscle/session before junk volume
const MAX_SLOTS_PER_MUSCLE = 2;   // ≤2 distinct exercises per muscle per day (e.g. a compound press + an isolation fly)
const SPLIT_MIN_SETS = 4;    // only split a muscle's day across 2 exercises when it's getting ≥4 sets
const STRONG_PRIMARY = 0.75; // a 2nd exercise must be a STRONG primary (≥0.75 contribution) of the muscle to count
                             // as a distinct stimulus — blocks 2 near-identical isolation variants (DB+machine raise)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// an exercise "trains" a muscle at the shared ≥0.5 basis (so Deadlift/glutes count, not just fraction==1)
const primaryFor = (ex: ExerciseDto, m: Muscle) => ex.category !== "CARDIO" && trainsMuscle(ex.muscleContributions, m);
const fracOf = (ex: ExerciseDto, m: Muscle): number =>
  ex.muscleContributions.reduce((f, c) => (c.muscle === m ? Math.max(f, parseFloat(c.fraction)) : f), 0);

export type Day = { name: string; muscles: Muscle[] };

/** Total back-to-back EFFECTIVE-muscle incidences across consecutive days — the recovery objective
 *  `orderForRecovery` minimizes (each shared muscle on an adjacent pair counts once). */
export function adjacencyConflicts(days: Day[], effOf: (d: Day) => Set<Muscle>): number {
  const eff = days.map(effOf);
  let n = 0;
  for (let i = 1; i < days.length; i++) for (const m of eff[i]) if (eff[i - 1].has(m)) n++;
  return n;
}

/** Order days to MINIMIZE back-to-back training of the same EFFECTIVE muscle (primaries + the ≥0.5
 *  synergists of its exercises) for ~48–72h recovery. Day count is tiny (≤6), so we search ALL orderings
 *  exhaustively and return the global minimum — a greedy nearest-neighbour from a fixed start is not
 *  optimal (it can't undo an early choice, nor pick a better first day). Permutations are generated in
 *  lexicographic index order and we keep the FIRST ordering that hits the min, so ties break toward the
 *  original day order (no gratuitous reshuffle). Falls back to greedy only above 8 days (never reached). */
export function orderForRecovery(days: Day[], effOf: (d: Day) => Set<Muscle>): Day[] {
  if (days.length <= 2) return days;
  if (days.length > 8) return greedyOrder(days, effOf);   // 9!+ perms — unreachable guard
  let best = days, bestScore = adjacencyConflicts(days, effOf);
  for (const perm of permutations(days)) {
    const score = adjacencyConflicts(perm, effOf);
    if (score < bestScore) { bestScore = score; best = perm; }
  }
  return best;
}
/** Greedy nearest-neighbour — fallback above the exhaustive cap only. */
function greedyOrder(days: Day[], effOf: (d: Day) => Set<Muscle>): Day[] {
  const rest = [...days];
  const out: Day[] = [rest.shift()!];
  while (rest.length) {
    const prev = effOf(out[out.length - 1]);
    let bestI = 0, bestShared = Infinity;
    rest.forEach((d, i) => {
      const shared = [...effOf(d)].reduce((n, m) => n + (prev.has(m) ? 1 : 0), 0);
      if (shared < bestShared) { bestShared = shared; bestI = i; }
    });
    out.push(rest.splice(bestI, 1)[0]);
  }
  return out;
}
/** All permutations of an array in lexicographic index order. */
function* permutations<T>(arr: T[]): Generator<T[]> {
  if (arr.length <= 1) { yield [...arr]; return; }
  for (let i = 0; i < arr.length; i++)
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)]))
      yield [arr[i], ...rest];
}
/** Count <48h adjacencies in a `weekLen`-slot week: shared EFFECTIVE muscles between training days in CONSECUTIVE
 *  slots (circular — the week repeats). A rest slot (null) between two sessions breaks the adjacency. */
export function scheduleConflicts(week: (Day | null)[], effOf: (d: Day) => Set<Muscle>): number {
  let n = 0;
  for (let i = 0; i < week.length; i++) {
    const a = week[i], b = week[(i + 1) % week.length];
    if (!a || !b) continue;   // a rest day breaks back-to-back
    const ea = effOf(a), eb = effOf(b);
    for (const m of eb) if (ea.has(m)) n++;
  }
  return n;
}
/** Place N training days into a `weekLen`-slot week (null = rest day) to MINIMIZE <48h same-muscle adjacencies
 *  (circular). When days/week < weekLen there's slack to insert rest days, so a muscle trained on ≤⌊weekLen/2⌋
 *  days gets ≥48h. Exhaustive over placements (P(7,N) ≤ 5040 for N≤6). Ties break toward the most even spread
 *  (largest min gap). Generalizes orderForRecovery (which had no rest days). */
export function scheduleWeek(days: Day[], effOf: (d: Day) => Set<Muscle>, weekLen = 7): (Day | null)[] {
  const n = days.length;
  if (n === 0) return new Array(weekLen).fill(null);
  if (n >= weekLen) return days.slice();   // no slack — adjacency unavoidable, keep order
  const eff = days.map(effOf);   // precompute once — the inner loop scores by index, never re-calls effOf
  const score = (slotDay: (number | null)[]): number => {
    let c = 0;
    for (let i = 0; i < weekLen; i++) {
      const a = slotDay[i], b = slotDay[(i + 1) % weekLen];
      if (a === null || b === null) continue;
      for (const m of eff[b]) if (eff[a].has(m)) c++;
    }
    return c;
  };
  const gap = (slotDay: (number | null)[]): number => {
    const at: number[] = []; slotDay.forEach((d, i) => { if (d !== null) at.push(i); });
    if (at.length <= 1) return weekLen;
    let min = weekLen;
    for (let i = 0; i < at.length; i++) min = Math.min(min, (at[(i + 1) % at.length] - at[i] + weekLen) % weekLen || weekLen);
    return min;
  };
  let bestPos = days.map((_, i) => i), bestScore = Infinity, bestSpread = -1;
  for (const perm of permutations(Array.from({ length: weekLen }, (_, i) => i))) {
    const slotDay: (number | null)[] = new Array(weekLen).fill(null);
    for (let k = 0; k < n; k++) slotDay[perm[k]] = k;
    const s = score(slotDay);
    if (s > bestScore) continue;
    const sp = gap(slotDay);
    if (s < bestScore || sp > bestSpread) { bestPos = perm.slice(0, n); bestScore = s; bestSpread = sp; }
  }
  const week: (Day | null)[] = new Array(weekLen).fill(null);
  bestPos.forEach((slot, k) => { week[slot] = days[k]; });
  return week;
}
/** Recovery warnings from the SCHEDULED week: a prime mover trained on two training days <48h apart (consecutive
 *  slots, circular). Only fires when the frequency is too high to fully space (e.g. 6 days/week). */
function scheduleWarnings(week: (Day | null)[], effOf: (d: Day) => Set<Muscle>): string[] {
  const out: string[] = [];
  for (const mover of PRIME_MOVERS) {
    for (let i = 0; i < week.length; i++) {
      const a = week[i], b = week[(i + 1) % week.length];
      if (a && b && effOf(a).has(mover) && effOf(b).has(mover)) {
        out.push(`${muscleLabel(mover)} is trained <48h apart (${a.name} → ${b.name}) — too many sessions to fully space at this frequency.`);
        break;
      }
    }
  }
  return out;
}

/**
 * Build one training day's boilerplate SLOTS — a muscle-group placeholder per unit of volume, each carrying a
 * RECOMMENDED default exercise the user can swap later. A muscle's per-day target (weekly target ÷ its weekly
 * frequency, clamped to a productive 2…cap range) is split across ⌈sets / SETS_PER_EXERCISE⌉ slots, bounded by
 * MAX_SLOTS_PER_MUSCLE and by how many distinct candidate exercises exist — so a 4-set chest day with several
 * pressing options becomes two slots (an incline press + a pec deck), while a 3-set lat day stays one slot. Pure
 * + tested (periodization.test.ts). `ptr` is the rotation cursor carried across days so defaults stay varied;
 * it's mutated. Muscles with no candidate exercise are returned in `missing` (a catalog gap → a warning).
 */
export function daySlots(
  day: Day, block: MesoInput, freq: Record<string, number>, cand: Record<string, ExerciseDto[]>,
  ptr: Record<string, number>, reps: number, targetRir: string,
): { slots: PlanSlot[]; missing: Muscle[] } {
  const slots: PlanSlot[] = [];
  const missing: Muscle[] = [];
  for (const m of day.muscles) {
    const weekly = targetSets(m, block, 1);
    if (weekly <= 0) continue;
    const list = cand[m];
    if (!list || !list.length) { missing.push(m); continue; }
    const setsPerDay = clamp(Math.round(weekly / (freq[m] || 1)), 2, PER_SESSION_CAP);
    const picks = pickDayExercises(list, m, setsPerDay, ptr);   // 1 exercise, or 2 only if distinct stimulus
    picks.forEach((ex, i) => {
      const sets = Math.floor(setsPerDay / picks.length) + (i < setsPerDay % picks.length ? 1 : 0);   // even split
      if (sets <= 0) return;
      slots.push({ muscle: m, sets, reps, targetRir, exerciseId: ex.id, name: ex.name });
    });
  }
  // intra-session order: spread same-muscle / shared-synergist work so no two consecutive slots fatigue the
  // same muscle when avoidable (e.g. don't run two chest movements back-to-back).
  const exById = new Map<string, ExerciseDto>();
  for (const l of Object.values(cand)) for (const e of l) exById.set(e.id, e);
  return { slots: orderSlotsForRecovery(slots, exById), missing };
}

/** Pick the exercise(s) for one muscle's day. ONE by default (rotated across days for variety); a SECOND only
 *  when the day's volume justifies it (≥SPLIT_MIN_SETS) AND a genuinely distinct movement exists — a STRONG
 *  primary (≥STRONG_PRIMARY contribution) of a DIFFERENT mechanic than the first pick. This keeps a real
 *  compound+isolation pair (chest: bench + fly) but collapses two near-identical isolations (side delts:
 *  dumbbell + machine lateral raise → 4 sets of one). `list` is pre-sorted by contribution desc. */
function pickDayExercises(list: ExerciseDto[], m: Muscle, setsPerDay: number, ptr: Record<string, number>): ExerciseDto[] {
  const primary = list[(ptr[m] = (ptr[m] ?? 0) + 1) % list.length];   // rotate → cross-day variety
  if (setsPerDay < SPLIT_MIN_SETS || MAX_SLOTS_PER_MUSCLE < 2) return [primary];
  const second = list.find((e) => e.id !== primary.id && e.mechanic !== primary.mechanic && fracOf(e, m) >= STRONG_PRIMARY);
  return second ? [primary, second] : [primary];
}

/** Reorder a day's slots so no two CONSECUTIVE slots train the same primary muscle (when ≥2 muscles are present),
 *  spreading shared-synergist work too. Round-robin interleave (largest muscle-group first, never repeating the
 *  last muscle while another group remains — the standard "reorganize so identical items aren't adjacent"), with
 *  a tiebreak toward the fewest shared EFFECTIVE muscles (slot muscle + ≥0.5 synergists of its exercise). */
function orderSlotsForRecovery(slots: PlanSlot[], exById: Map<string, ExerciseDto>): PlanSlot[] {
  if (slots.length <= 2) return slots;
  const eff = (s: PlanSlot): Set<Muscle> => {
    const set = new Set<Muscle>([s.muscle]);
    const ex = s.exerciseId ? exById.get(s.exerciseId) : null;
    for (const c of ex?.muscleContributions ?? []) if (parseFloat(c.fraction) >= TRAINS_THRESHOLD) set.add(c.muscle);
    return set;
  };
  const shared = (a: PlanSlot, b: PlanSlot | undefined): number => {
    if (!b) return 0;
    const eb = eff(b); let n = 0; for (const m of eff(a)) if (eb.has(m)) n++; return n;
  };
  const byMuscle = new Map<Muscle, PlanSlot[]>();
  for (const s of slots) { const g = byMuscle.get(s.muscle); if (g) g.push(s); else byMuscle.set(s.muscle, [s]); }
  const out: PlanSlot[] = [];
  while (out.length < slots.length) {
    const last = out[out.length - 1];
    const groups = [...byMuscle.values()].filter((g) => g.length);
    let elig = groups.filter((g) => !last || g[0].muscle !== last.muscle);
    if (!elig.length) elig = groups;   // only same-muscle slots remain — unavoidable
    elig.sort((a, b) => b.length - a.length || shared(a[0], last) - shared(b[0], last));
    out.push(elig[0].shift()!);
  }
  return out;
}

/**
 * Build a split + slotted templates for one block. The microcycle is DESIGNED so every prime mover (and every
 * focus muscle) lands ≥2×/week — not merely warned about after the fact: any such muscle the base shape hits
 * <2× is added to the lightest day(s) that lack it. Exercise choice is goal-aware (compounds for strength) and
 * rotated for variety; each day's muscles become user-swappable SLOTS (see daySlots).
 */
function generateSplit(block: MesoInput, daysPerWeek: number, exercises: ExerciseDto[]): Omit<PlanPreview, "mesocycles" | "totalWeeks"> {
  const base = (SHAPES[clamp(daysPerWeek, 2, 6)] ?? SHAPES[3]).map((d) => ({ name: d.name, muscles: [...d.muscles] }));

  // FREQUENCY-BY-DESIGN: guarantee every prime mover AND focus muscle reaches ≥2 sessions/week by adding it to
  // the lightest days that don't already include it (was: only focus muscles patched; prime-mover shortfalls
  // were merely warned). Schoenfeld 2016 — ≥2×/wk beats 1× for hypertrophy, volume-equated.
  for (const m of [...PRIME_MOVERS, ...block.focusMuscles]) {
    const has = (d: Day) => d.muscles.includes(m);
    let f = base.filter(has).length;
    if (f >= MIN_FREQ) continue;
    for (const d of base.filter((d) => !has(d)).sort((a, b) => a.muscles.length - b.muscles.length)) {
      if (f >= MIN_FREQ) break;
      d.muscles.push(m); f++;
    }
  }

  // candidate exercises per muscle (goal-aware, best-contribution first), built once
  const candFor = (m: Muscle) => {
    let c = exercises.filter((e) => primaryFor(e, m));
    if (block.blockType === "STRENGTH" || block.blockType === "PEAK") {
      const compounds = c.filter((e) => e.mechanic === "COMPOUND");
      if (compounds.length) c = compounds;
    }
    return c.slice().sort((a, b) => fracOf(b, m) - fracOf(a, m));   // prefer the strongest contributor
  };
  const cand: Record<string, ExerciseDto[]> = {};
  const ptr: Record<string, number> = {};
  for (const m of new Set(base.flatMap((d) => d.muscles))) cand[m] = candFor(m as Muscle);

  // effective muscles for recovery spacing = the day's muscles + the ≥0.5 synergists of its top exercises
  const effOf = (d: Day): Set<Muscle> => {
    const s = new Set<Muscle>(d.muscles);
    for (const m of d.muscles) for (const c of cand[m]?.[0]?.muscleContributions ?? [])
      if (parseFloat(c.fraction) >= TRAINS_THRESHOLD) s.add(c.muscle);
    return s;
  };

  // schedule the week: place the training days among 7 weekday slots with rest days between them so each
  // muscle gets ≥48h where the frequency allows (generalizes back-to-back ordering — see scheduleWeek).
  const week = scheduleWeek(base, effOf, 7);
  const scheduled: { day: Day; slot: number }[] = [];
  week.forEach((d, slot) => { if (d) scheduled.push({ day: d, slot }); });
  const days = scheduled.map((s) => s.day);

  const freq: Record<string, number> = {};
  for (const d of days) for (const m of d.muscles) freq[m] = (freq[m] ?? 0) + 1;

  // per-block prescription: target reps (range low) + week-1 RIR = the start of the wave (3), floored by
  // the phase — same value the log screen seeds at week 1, so accept-time == first session.
  const reps = block.intensityBand?.repLow ?? 8;
  const targetRir = String(Math.max(phaseMod(block.phase).rirFloor, 3));

  const missing = new Set<Muscle>();
  const templates: PlanTemplate[] = days.map((d) => {
    const { slots, missing: gap } = daySlots(d, block, freq, cand, ptr, reps, targetRir);
    gap.forEach((m) => missing.add(m));
    return { name: d.name, slots };
  });
  const schedule = scheduled.map((s) => s.slot);

  // Recovery notes come from the SCHEDULED week (only fire when frequency can't be spaced); plus catalog gaps.
  const warnings: string[] = [...scheduleWarnings(week, effOf)];
  for (const m of block.focusMuscles) if (missing.has(m)) warnings.push(`No exercise for focus muscle ${muscleLabel(m)} — add one to your catalog.`);
  for (const m of missing) if (!block.focusMuscles.includes(m)) warnings.push(`No exercise for ${muscleLabel(m)} — that muscle's slot is unfilled.`);

  return { splitName: `${blockLabel(block.blockType)} split`, templates, warnings, schedule };
}

/**
 * Plan a macrocycle: a sequence of mesocycle blocks (whole macro) + a split/templates for the FIRST block.
 * Backward from targetDate when present; the same function computes preview and accept payload.
 */
export function planMacrocycle(
  goal: GoalType, durationWeeks: number, targetDate: string | null,
  focusMuscles: Muscle[], daysPerWeek: number, exercises: ExerciseDto[],
  measuredPhase: string | null = null, measuredConfidence: string | null = null,
): PlanPreview {
  // A measured energy phase overrides the recipe's aspirational phase ONLY at HIGH confidence; under
  // low/unknown confidence we ignore the reading and let the goal's recipe stand (the rule is enforced
  // here in the planner, not just at the UI call site). (council D1 / docs/coach.md)
  const measured = measuredConfidence === "HIGH" ? measuredPhase : null;
  let total = Math.max(5, durationWeeks);
  if (targetDate) {
    const wks = Math.round((new Date(targetDate).getTime() - Date.now()) / (7 * DAY));
    if (wks > 0) total = Math.max(2, wks);
  }
  const focus = (goal === "MUSCLE_FOCUS" || goal === "CONTEST_PREP") ? focusMuscles.slice(0, 3) : [];
  const blocks: MesoInput[] = [];
  let used = 0;

  if (goal === "CONTEST_PREP") {
    const prepWeeks = Math.max(0, total - 2);                    // reserve 2 weeks for the peak block (accum 1 + deload)
    let i = 0;
    // Fill prepWeeks with PREP blocks (each costs accum+1 weeks) WITHOUT overshooting the show date: a
    // standard 4+1 block while ≥7 weeks remain, otherwise the final block absorbs the exact remainder.
    // (The old `max(3, …)` forced accum≥3 and overran prepWeeks, pushing the immovable peak past the date.)
    while (prepWeeks - used >= 2) {
      const remaining = prepWeeks - used;
      const accum = Math.max(1, remaining >= 7 ? 4 : remaining - 1);
      blocks.push(mkBlock({ blockType: "PREP", accum, phase: "DEFICIT" }, focus, blocks.length + 1, measured));
      used += accum + 1; i++;
      if (i > 12) break;
    }
    blocks.push(mkBlock({ blockType: "PEAK", accum: 1, phase: "DEFICIT" }, focus, blocks.length + 1, measured));
    used += 2;
  } else {
    const unit = recipeUnit(goal);
    let i = 0;
    while (used < total) {
      const spec = unit[i % unit.length];
      const weeks = spec.accum + 1;
      if (used > 0 && used + weeks > total + 2) break;
      blocks.push(mkBlock(spec, focus, blocks.length + 1, measured));
      used += weeks; i++;
      if (i > 40) break;
    }
    if (blocks.length === 0) blocks.push(mkBlock(unit[0], focus, 1, measured)), used += unit[0].accum + 1;
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
