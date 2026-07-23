// Thin typed wrapper over the Workout Logger REST API — the SAME contract the frontend's
// client.ts rides. The MCP tools call these methods; tenant isolation is inherited from the
// backend (every repo ANDs userId into every query), so this layer never re-implements it.
//
// The identity seam: `getToken` is INJECTED, never hardcoded. Locally it resolves once at
// startup (login or a pasted token); the future remote server swaps it for a per-request
// OAuth-derived token and nothing else in this file moves. That injection is exactly what
// keeps the server stateless — and therefore trivially scalable.

export type FetchLike = typeof fetch;

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AuthResponse {
  token: string;
  userId: string;
  email: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;

/** POST /auth/login → JWT. Used by the local identity provider at startup. */
export async function login(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: FetchLike = fetch,
): Promise<AuthResponse> {
  const res = await fetchImpl(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401) throw new ApiError(401, "Incorrect email or password.");
  if (!res.ok) throw new ApiError(res.status, `Login failed (${res.status})`);
  return (await res.json()) as AuthResponse;
}

export interface ApiOptions {
  baseUrl: string;
  /** Injected identity — see the seam note above. Returns the bearer token for a call. */
  getToken: () => Promise<string>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** Factory so a per-request identity can be injected later (remote) without touching tools. */
export function createApi(opts: ApiOptions) {
  const { baseUrl, getToken, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
    } catch (e) {
      if (controller.signal.aborted) throw new ApiError(0, "Backend isn't responding — is it running on :8080?");
      throw new ApiError(0, `Network error reaching the backend: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      let detail: unknown;
      try {
        const body = await res.json();
        message = body.message ?? message;
        detail = body.detail;
      } catch { /* non-JSON error body */ }
      throw new ApiError(res.status, message, detail);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const get = <T>(p: string) => request<T>(p);
  const post = <T>(p: string, body?: unknown) =>
    request<T>(p, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  const put = <T>(p: string, body: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(body) });
  const patch = <T>(p: string, body: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(body) });
  const del = <T>(p: string) => request<T>(p, { method: "DELETE" });

  return {
    // reads
    me: () => get("/me"),
    energy: () => get("/me/energy"),
    getPlan: () => get("/plan"),
    planHistory: () => get("/plan/history"),
    listExercises: () => get("/exercises"),
    lastWorkingSet: (exerciseId: string) => get(`/exercises/${exerciseId}/last-working-set`),
    listWorkouts: () => get("/workouts"),
    getWorkout: (id: string) => get(`/workouts/${id}`),
    listTemplates: () => get("/templates"),
    listSplits: () => get("/splits"),

    // workout writes
    createWorkout: (body: unknown) => post("/workouts", body),
    updateWorkout: (id: string, body: unknown) => put(`/workouts/${id}`, body),
    deleteWorkout: (id: string) => del(`/workouts/${id}`),

    // profile / bodyweight writes
    setBodyweight: (weightKg: string, recordedAt?: string) =>
      put("/me/bodyweight", { weightKg, recordedAt }),
    updateProfile: (patchBody: unknown) => put("/me/profile", patchBody),

    // plan writes
    createPlan: (body: unknown) => post("/plan", body),
    advancePlan: () => post("/plan/advance"),
    addMesocycle: (m: unknown) => post("/plan/mesocycle", m),
    endPlan: () => del("/plan"),

    // exercise / catalog writes
    createExercise: (body: unknown) => post("/exercises", body),
    updateExercise: (id: string, patchBody: unknown) => patch(`/exercises/${id}`, patchBody),
    restoreDefaultExercises: () => post("/exercises/restore-defaults"),

    // low-level escape hatch (kept internal; not exposed as a tool)
    _request: request,
  };
}

export type WorkoutApi = ReturnType<typeof createApi>;

/**
 * Local identity provider. Resolves ONCE at startup — the whole process acts as one user.
 * The remote server replaces this with a per-request provider; tools are unaffected because
 * they only ever see `getToken`.
 */
export async function resolveLocalToken(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<() => Promise<string>> {
  const explicit = env.WORKOUT_LOGGER_TOKEN?.trim();
  if (explicit) return async () => explicit;

  const email = env.WORKOUT_LOGGER_EMAIL?.trim();
  const password = env.WORKOUT_LOGGER_PASSWORD; // pragma: allowlist secret
  if (!email || !password) {
    throw new Error(
      "No identity configured. Set WORKOUT_LOGGER_TOKEN, or WORKOUT_LOGGER_EMAIL + WORKOUT_LOGGER_PASSWORD.",
    );
  }
  const auth = await login(baseUrl, email, password, fetchImpl);
  // Cache the token for the process lifetime (single-user, single session).
  return async () => auth.token;
}
