import type {
  AuthResponse, CardioMetric, CreatePlanRequest, CreateWorkoutRequest, EnergyDto, Equipment, ExerciseDto,
  Laterality, LastWorkingSetDto, MacrocycleDto, Mechanic, MeDto, MesoInput, MuscleContributionDto, SaveSplitRequest,
  SaveTemplateRequest, SplitDto, TemplateDto, UpdateProfileRequest, WorkoutDto,
} from "./types";

const TOKEN_KEY = "wl.token";

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401) {
    // A 401 from the sign-in / sign-up call itself means bad credentials, not an expired session: surface a
    // credentials message and don't clear a token we don't have. Any OTHER 401 means the stored token is
    // stale — clear it and prompt a fresh sign-in.
    if (path.startsWith("/auth/")) throw new ApiError(401, "Incorrect email or password.");
    tokenStore.clear();
    throw new ApiError(401, "Session expired — please sign in again.");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let detail: unknown;
    try {
      const body = await res.json();
      message = body.message ?? message;
      detail = body.detail;
    } catch { /* non-JSON error */ }
    throw new ApiError(res.status, message, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const Api = {
  // auth
  register: (email: string, password: string) =>
    api<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    api<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  // me
  me: () => api<MeDto>("/me"),
  setBodyweight: (weightKg: string, recordedAt?: string) =>
    api<MeDto>("/me/bodyweight", { method: "PUT", body: JSON.stringify({ weightKg, recordedAt }) }),
  updateBodyweightEntry: (id: string, patch: { weightKg?: string; recordedAt?: string }) =>
    api<MeDto>(`/me/bodyweight/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteBodyweightEntry: (id: string) =>
    api<MeDto>(`/me/bodyweight/${id}`, { method: "DELETE" }),
  updateProfile: (patch: UpdateProfileRequest) =>
    api<MeDto>("/me/profile", { method: "PUT", body: JSON.stringify(patch) }),
  energy: () => api<EnergyDto>("/me/energy"),

  // plan (macro/meso/microcycle)
  getPlan: () => api<MacrocycleDto | null>("/plan").then((r) => r ?? null),
  createPlan: (body: CreatePlanRequest) =>
    api<MacrocycleDto>("/plan", { method: "POST", body: JSON.stringify(body) }),
  advancePlan: () => api<MacrocycleDto>("/plan/advance", { method: "POST" }),
  addMesocycle: (m: MesoInput) =>
    api<MacrocycleDto>("/plan/mesocycle", { method: "POST", body: JSON.stringify(m) }),
  endPlan: () => api<void>("/plan", { method: "DELETE" }),

  // exercises
  listExercises: () => api<ExerciseDto[]>("/exercises"),
  restoreDefaultExercises: () => api<{ added: number }>("/exercises/restore-defaults", { method: "POST" }),
  createExercise: (name: string, isBodyweight: boolean, category: string = "STRENGTH",
                   restSeconds?: number | null, cardioMetrics?: CardioMetric[] | null) =>
    api<ExerciseDto>("/exercises", { method: "POST", body: JSON.stringify({ name, isBodyweight, category, restSeconds, cardioMetrics }) }),
  setExerciseEquipment: (id: string, equipment: Equipment) =>
    api<ExerciseDto>(`/exercises/${id}`, { method: "PATCH", body: JSON.stringify({ equipment }) }),
  updateExercise: (id: string, patch: { equipment?: Equipment; restSeconds?: number | null; cardioMetrics?: CardioMetric[] | null; muscleContributions?: MuscleContributionDto[]; laterality?: Laterality; mechanic?: Mechanic; loadable?: boolean }) =>
    api<ExerciseDto>(`/exercises/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  lastWorkingSet: (exerciseId: string) =>
    api<LastWorkingSetDto | null>(`/exercises/${exerciseId}/last-working-set`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),

  // workouts
  listWorkouts: () => api<WorkoutDto[]>("/workouts"),
  getWorkout: (id: string) => api<WorkoutDto>(`/workouts/${id}`),
  createWorkout: (body: CreateWorkoutRequest) =>
    api<WorkoutDto>("/workouts", { method: "POST", body: JSON.stringify(body) }),
  updateWorkout: (id: string, body: CreateWorkoutRequest) =>
    api<WorkoutDto>(`/workouts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteWorkout: (id: string) => api<void>(`/workouts/${id}`, { method: "DELETE" }),

  // templates
  listTemplates: () => api<TemplateDto[]>("/templates"),
  createTemplate: (body: SaveTemplateRequest) =>
    api<TemplateDto>("/templates", { method: "POST", body: JSON.stringify(body) }),
  updateTemplate: (id: string, body: SaveTemplateRequest) =>
    api<TemplateDto>(`/templates/${id}`, { method: "PUT", body: JSON.stringify(body) }),

  // splits
  listSplits: () => api<SplitDto[]>("/splits"),
  createSplit: (body: SaveSplitRequest) =>
    api<SplitDto>("/splits", { method: "POST", body: JSON.stringify(body) }),
  updateSplit: (id: string, body: SaveSplitRequest) =>
    api<SplitDto>(`/splits/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteSplit: (id: string) => api<void>(`/splits/${id}`, { method: "DELETE" }),
};
