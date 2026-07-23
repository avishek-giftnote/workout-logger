import { z } from "zod";

// These mirror the backend's Bean-Validation @Pattern constants (ApiDtos.java) EXACTLY, so the
// invariant "weights are decimal STRINGS, never floats" is enforced before a value ever leaves
// this process. The backend re-validates authoritatively; this is the guard-first layer that
// keeps a JS `number` from silently rounding a ~0.25 kg fractional plate on the way in.
export const DECIMAL_PATTERN = /^-?\d{1,4}(\.\d{1,3})?$/;          // weight, loadDelta, weightKg (≤9999)
export const CARDIO_DISTANCE_PATTERN = /^\d{1,6}(\.\d{1,3})?$/;    // distanceM (≤999999.999)
export const CARDIO_GRADE_PATTERN = /^-?\d{1,2}(\.\d{1,2})?$/;     // gradePct (≤99.99, signed)
export const CARDIO_ELEVATION_PATTERN = /^\d{1,5}(\.\d{1,3})?$/;   // elevationGainM (≤20000)

const decimal = z.string().regex(DECIMAL_PATTERN, "must be a decimal string ≤ 9999 (never a JSON number)");
const cardioDistance = z.string().regex(CARDIO_DISTANCE_PATTERN, "distanceM must be a non-negative decimal string");
const cardioGrade = z.string().regex(CARDIO_GRADE_PATTERN, "gradePct must be a signed decimal string ≤ 99.99");
const cardioElevation = z.string().regex(CARDIO_ELEVATION_PATTERN, "elevationGainM must be a non-negative decimal string");

export const setType = z.enum(["WARMUP", "WORKING", "DROP", "FAILURE"]);
export const loadMode = z.enum(["BODYWEIGHT", "ADDED", "ASSISTED"]);
export const setKind = z.enum(["STRENGTH", "CARDIO"]);
export const cyclePhase = z.enum(["ACCUMULATION", "DELOAD"]);
export const muscle = z.enum([
  "CHEST", "FRONT_DELT", "SIDE_DELT", "REAR_DELT", "LAT", "UPPER_BACK", "TRAP",
  "BICEP", "TRICEP", "FOREARM", "QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS",
]);

// CreateSetRequest — decimals stay strings; reps/rpe are bounded ints (matches @Min/@Max).
export const createSet = z.object({
  orderIndex: z.number().int(),
  setType,
  weight: decimal.nullish(),
  loadMode: loadMode.nullish(),
  loadDelta: decimal.nullish(),
  reps: z.number().int().min(0).max(1000).nullish(),
  rpe: z.number().int().min(1).max(10).nullish(),
  note: z.string().nullish(),
  kind: setKind.nullish(),
  distanceM: cardioDistance.nullish(),
  durationS: z.number().int().min(0).max(86400).nullish(),
  gradePct: cardioGrade.nullish(),
  elevationGainM: cardioElevation.nullish(),
  cadenceSpm: z.number().int().min(0).max(300).nullish(),
});

export const createBlock = z.object({
  exerciseId: z.string().min(1),
  name: z.string().nullish(),
  position: z.number().int(),
  note: z.string().nullish(),
  sets: z.array(createSet),
});

// The raw shapes (not z.object) are what McpServer.registerTool wants for inputSchema.
export const logWorkoutShape = {
  startedAt: z.string().describe("ISO-8601 start time, e.g. 2026-07-21T18:30:00Z"),
  durationSeconds: z.number().int().min(0).nullish(),
  templateId: z.string().nullish(),
  cyclePhase: cyclePhase.nullish(),
  soreMuscles: z.array(muscle).nullish(),
  exercises: z.array(createBlock).describe("One block per exercise, each with its ordered sets"),
} as const;

export const setBodyweightShape = {
  weightKg: decimal.describe("Bodyweight in kg as a decimal STRING, e.g. \"82.5\""),
  recordedAt: z.string().nullish().describe("ISO timestamp; defaults to now"),
} as const;

export const idShape = { id: z.string().min(1) } as const;
export const exerciseIdShape = { exerciseId: z.string().min(1) } as const;

// Mesocycle input for add_mesocycle / building a plan.
export const mesoInputShape = {
  name: z.string(),
  accumulationWeeks: z.number().int().min(1),
  phase: z.string(),
  focusMuscles: z.array(muscle),
  blockType: z.enum(["HYPERTROPHY", "STRENGTH", "PEAK", "RESENSITIZATION", "MAINTENANCE", "PREP"]).nullish(),
} as const;

export const createPlanShape = {
  name: z.string(),
  mesocycles: z.array(z.object(mesoInputShape)),
  goal: z.enum(["GENERAL_HYPERTROPHY", "MUSCLE_FOCUS", "STRENGTH", "CONTEST_PREP"]).nullish(),
  targetDate: z.string().nullish(),
  focusMuscles: z.array(muscle).nullish(),
  splitId: z.string().nullish(),
} as const;

export const createExerciseShape = {
  name: z.string().min(1),
  isBodyweight: z.boolean(),
  category: z.string().default("STRENGTH"),
  restSeconds: z.number().int().nullish(),
  cardioMetrics: z.array(z.enum(["DISTANCE", "DURATION", "PACE", "GRADE", "ELEVATION", "CADENCE"])).nullish(),
} as const;

export const updateProfileShape = {
  dateOfBirth: z.string().nullish(),
  heightCm: decimal.nullish(),
  sex: z.enum(["MALE", "FEMALE", "UNSPECIFIED"]).nullish(),
  goal: z.enum(["GAIN_MUSCLE", "LOSE_FAT", "MAINTAIN", "GAIN_STRENGTH"]).nullish(),
  activityLevel: z.enum(["SEDENTARY", "LIGHT", "MODERATE", "ACTIVE", "VERY_ACTIVE"]).nullish(),
  initialIntakeKcal: z.number().int().nullish(),
} as const;
