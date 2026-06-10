import type {
  AuthResponse, CardioMetric, CreateWorkoutRequest, Equipment, ExerciseDto, LastWorkingSetDto,
  MeDto, SaveSplitRequest, SaveTemplateRequest, SplitDto, TemplateDto, WorkoutDto,
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
  setBodyweight: (weightKg: string) =>
    api<MeDto>("/me/bodyweight", { method: "PUT", body: JSON.stringify({ weightKg }) }),

  // exercises
  listExercises: () => api<ExerciseDto[]>("/exercises"),
  createExercise: (name: string, isBodyweight: boolean, category: string = "STRENGTH",
                   restSeconds?: number | null, cardioMetrics?: CardioMetric[] | null) =>
    api<ExerciseDto>("/exercises", { method: "POST", body: JSON.stringify({ name, isBodyweight, category, restSeconds, cardioMetrics }) }),
  setExerciseEquipment: (id: string, equipment: Equipment) =>
    api<ExerciseDto>(`/exercises/${id}`, { method: "PATCH", body: JSON.stringify({ equipment }) }),
  updateExercise: (id: string, patch: { equipment?: Equipment; restSeconds?: number | null; cardioMetrics?: CardioMetric[] | null }) =>
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
