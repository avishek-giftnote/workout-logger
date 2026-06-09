// Mirrors the backend ApiDtos. Weights are decimal STRINGS on the wire (DESIGN §3.1) —
// never parse them into JS numbers for storage; only for transient display math.
// (Regenerate from /v3/api-docs with openapi-typescript once the server is running.)

export type SetType = "WARMUP" | "WORKING" | "DROP" | "FAILURE";
export type LoadMode = "BODYWEIGHT" | "ADDED" | "ASSISTED";

export interface AuthResponse { token: string; userId: string; email: string; }

export interface ExerciseDto {
  id: string;
  name: string;
  isBodyweight: boolean;
  defaultUnit: string;
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
}

export interface ExerciseBlockDto {
  exerciseId: string;
  name: string;
  position: number;
  note: string | null;
  sets: SetDto[];
}

export interface WorkoutDto {
  id: string;
  startedAt: string;
  durationSeconds: number | null;
  rawDurationText: string | null;
  templateId: string | null;
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
  exercises: CreateBlockRequest[];
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

export interface TemplateExerciseDto { exerciseId: string; name: string; position: number; sets: number; }
export interface TemplateDto { id: string; name: string; exercises: TemplateExerciseDto[]; }

export interface TemplateExerciseInput { exerciseId: string; name?: string | null; position: number; sets: number; }
export interface SaveTemplateRequest { name: string; exercises: TemplateExerciseInput[]; }

export interface BodyweightEntryDto { recordedAt: string; weightKg: string | null; estimated: boolean; }
export interface MeDto {
  id: string;
  email: string;
  currentBodyweightKg: string | null;
  bodyweightLog: BodyweightEntryDto[];
}
