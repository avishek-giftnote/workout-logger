// Mirrors the backend ApiDtos. Weights are decimal STRINGS on the wire (DESIGN §3.1) —
// never parse them into JS numbers for storage; only for transient display math.
// (Regenerate from /v3/api-docs with openapi-typescript once the server is running.)

export type SetType = "WARMUP" | "WORKING" | "DROP" | "FAILURE";
export type LoadMode = "BODYWEIGHT" | "ADDED" | "ASSISTED";

export interface AuthResponse { token: string; userId: string; email: string; }

export type Equipment =
  "DUMBBELL" | "BARBELL" | "SMITH_MACHINE" | "KETTLEBELL" | "MACHINE" | "CABLE" | "BODYWEIGHT" | "OTHER";

export type SetKind = "STRENGTH" | "CARDIO";

export type CardioMetric = "DISTANCE" | "DURATION" | "PACE" | "GRADE" | "ELEVATION" | "CADENCE";

export type Muscle =
  | "CHEST" | "FRONT_DELT" | "SIDE_DELT" | "REAR_DELT" | "LAT" | "UPPER_BACK" | "TRAP"
  | "BICEP" | "TRICEP" | "FOREARM" | "QUAD" | "HAMSTRING" | "GLUTE" | "CALF" | "ABS";
export interface MuscleContributionDto { muscle: Muscle; fraction: string; }
export type Laterality = "BILATERAL" | "ISOLATERAL" | "UNILATERAL";
export type Mechanic = "COMPOUND" | "ISOLATION";

export interface ExerciseDto {
  id: string;
  name: string;
  isBodyweight: boolean;
  equipment: Equipment | null;
  category: string;
  defaultUnit: string;
  restSeconds: number | null;            // exercise-specific rest target; null ⇒ global default
  cardioMetrics: CardioMetric[] | null;  // CARDIO only; null ⇒ default set
  muscleContributions: MuscleContributionDto[];  // seeded from name when the user hasn't set them
  laterality: Laterality | null;
  mechanic: Mechanic | null;
  loadable: boolean | null;              // can add/reduce resistance (esp. for bodyweight)
}

export interface SetDto {
  id: string;
  orderIndex: number;
  setType: SetType;
  weight: string | null;
  loadMode: LoadMode | null;
  loadDelta: string | null;
  weightUnit: string;
  reps: number | null;
  rpe: number | null;
  note: string | null;
  estimated: boolean | null;
  // cardio (nullable; pace/speed derived from distance + duration)
  kind: SetKind | null;
  distanceM: string | null;
  durationS: number | null;
  gradePct: string | null;
  elevationGainM: string | null;
  cadenceSpm: number | null;
}

export interface ExerciseBlockDto {
  exerciseId: string;
  name: string;
  position: number;
  note: string | null;
  sets: SetDto[];
}

export type CyclePhase = "ACCUMULATION" | "DELOAD";

export interface WorkoutDto {
  id: string;
  startedAt: string;
  durationSeconds: number | null;
  rawDurationText: string | null;
  templateId: string | null;
  cyclePhase: CyclePhase | null;
  exercises: ExerciseBlockDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSetRequest {
  orderIndex: number;
  setType: SetType;
  weight?: string | null;
  loadMode?: LoadMode | null;
  loadDelta?: string | null;
  reps?: number | null;
  rpe?: number | null;
  note?: string | null;
  kind?: SetKind | null;
  distanceM?: string | null;
  durationS?: number | null;
  gradePct?: string | null;
  elevationGainM?: string | null;
  cadenceSpm?: number | null;
}

export interface CreateBlockRequest {
  exerciseId: string;
  name?: string | null;
  position: number;
  note?: string | null;
  sets: CreateSetRequest[];
}

export interface CreateWorkoutRequest {
  startedAt: string;
  durationSeconds?: number | null;
  templateId?: string | null;
  cyclePhase?: CyclePhase | null;
  exercises: CreateBlockRequest[];
}

export type GoalType = "GENERAL_HYPERTROPHY" | "MUSCLE_FOCUS" | "STRENGTH" | "CONTEST_PREP";
export type BlockType = "HYPERTROPHY" | "STRENGTH" | "PEAK" | "RESENSITIZATION" | "MAINTENANCE" | "PREP";
export interface IntensityBand { repLow: number; repHigh: number; targetRir: string; pctLow: string | null; pctHigh: string | null; }

export interface MesocycleDto {
  name: string; accumulationWeeks: number; phase: string; focusMuscles: Muscle[];
  blockType: BlockType | null; intensityBand: IntensityBand | null;
}
export interface MacrocycleDto {
  id: string; name: string; startedAt: string; status: string;
  mesoIndex: number; week: number; mesocycles: MesocycleDto[];
  goal: string | null; targetDate: string | null; focusMuscles: Muscle[] | null;
}
export interface MesoInput {
  name: string; accumulationWeeks: number; phase: string; focusMuscles: Muscle[];
  blockType?: BlockType | null; intensityBand?: IntensityBand | null;
}
export interface CreatePlanRequest {
  name: string; mesocycles: MesoInput[];
  goal?: string | null; targetDate?: string | null; focusMuscles?: Muscle[] | null;
}

export interface LastWorkingSetDto {
  exerciseName: string;
  startedAt: string;
  orderIndex: number;
  weight: string | null;
  loadMode: LoadMode | null;
  loadDelta: string | null;
  reps: number | null;
  rpe: number | null;
}

export interface TemplateExerciseDto { exerciseId: string; name: string; position: number; sets: number; reps: number | null; targetRir: string | null; }
export interface TemplateDto { id: string; name: string; exercises: TemplateExerciseDto[]; }

export interface TemplateExerciseInput { exerciseId: string; name?: string | null; position: number; sets: number; reps?: number | null; targetRir?: string | null; }
export interface SaveTemplateRequest { name: string; exercises: TemplateExerciseInput[]; }

export interface SplitDto { id: string; name: string; templateIds: string[]; }
export interface SaveSplitRequest { name: string; templateIds: string[]; }

export interface BodyweightEntryDto { id: string; recordedAt: string; weightKg: string | null; estimated: boolean; }

export type Sex = "MALE" | "FEMALE" | "UNSPECIFIED";
export type Goal = "GAIN_MUSCLE" | "LOSE_FAT" | "MAINTAIN" | "GAIN_STRENGTH";
export type ActivityLevel = "SEDENTARY" | "LIGHT" | "MODERATE" | "ACTIVE" | "VERY_ACTIVE";
export interface ProfileDto {
  dateOfBirth: string | null;   // ISO yyyy-MM-dd
  heightCm: string | null;
  sex: Sex | null;
  goal: Goal | null;
  activityLevel: ActivityLevel | null;
  initialIntakeKcal: number | null;
}
export interface UpdateProfileRequest {
  dateOfBirth?: string | null;
  heightCm?: string | null;
  sex?: Sex | null;
  goal?: Goal | null;
  activityLevel?: ActivityLevel | null;
  initialIntakeKcal?: number | null;
}
export interface MeDto {
  id: string;
  email: string;
  currentBodyweightKg: string | null;
  bodyweightLog: BodyweightEntryDto[];
  profile: ProfileDto | null;
}

export interface EnergyDto {
  status: "GATHERING_DATA" | "READY";
  phase: "SURPLUS" | "DEFICIT" | "MAINTENANCE" | "UNKNOWN";
  confidence: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  weighIns: number;
  spanDays: number;
  minWeighIns: number;
  minSpanDays: number;
  ratePerWeekKg: string | null;
  maintenanceKcalLow: number | null;
  maintenanceKcalHigh: number | null;
  surplusDeficitKcalLow: number | null;
  surplusDeficitKcalHigh: number | null;
  missingProfile: string[];
}
