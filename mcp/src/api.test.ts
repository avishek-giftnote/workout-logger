import { describe, it, expect, vi } from "vitest";
import { ApiError, createApi, resolveLocalToken } from "./api.js";

const json = (body: unknown, status = 200) =>
  status === 204
    ? new Response(null, { status: 204 }) // 204 is a null-body status; a body throws in the Response ctor
    : new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function apiWith(fetchImpl: typeof fetch, getToken = async () => "tok-123") {
  return createApi({ baseUrl: "http://api.test/api", getToken, fetchImpl });
}

describe("createApi request building", () => {
  it("GETs with the injected bearer token and the /api base", async () => {
    const fetchImpl = vi.fn(async () => json([{ id: "w1" }]));
    const api = apiWith(fetchImpl as unknown as typeof fetch);
    const out = await api.listWorkouts();

    expect(out).toEqual([{ id: "w1" }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://api.test/api/workouts");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-123" });
  });

  it("resolves the token per call (identity seam) — a changing provider is honored", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const api = apiWith(fetchImpl as unknown as typeof fetch, async () => `tok-${++n}`);
    await api.me();
    await api.me();
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-1" });
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok-2" });
  });

  it("serializes a POST body as JSON", async () => {
    const fetchImpl = vi.fn(async () => json({ id: "w2" }, 200));
    const api = apiWith(fetchImpl as unknown as typeof fetch);
    await api.createWorkout({ startedAt: "2026-07-21T00:00:00Z", exercises: [] });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ startedAt: "2026-07-21T00:00:00Z", exercises: [] });
  });

  it("treats 204 as undefined (delete/end)", async () => {
    const fetchImpl = vi.fn(async () => json(null, 204));
    const api = apiWith(fetchImpl as unknown as typeof fetch);
    await expect(api.deleteWorkout("w1")).resolves.toBeUndefined();
  });

  it("maps a non-ok response to an ApiError carrying the backend message", async () => {
    const fetchImpl = vi.fn(async () => json({ message: "not found" }, 404));
    const api = apiWith(fetchImpl as unknown as typeof fetch);
    await expect(api.getWorkout("nope")).rejects.toMatchObject({ status: 404, message: "not found" });
    await expect(api.getWorkout("nope")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("resolveLocalToken (local identity provider)", () => {
  it("uses an explicit token verbatim without hitting the network", async () => {
    const fetchImpl = vi.fn();
    const getToken = await resolveLocalToken("http://api.test/api", { WORKOUT_LOGGER_TOKEN: "abc" } as NodeJS.ProcessEnv, fetchImpl as unknown as typeof fetch);
    expect(await getToken()).toBe("abc");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logs in with email/password to obtain a token", async () => {
    const fetchImpl = vi.fn(async () => json({ token: "jwt-xyz", userId: "u1", email: "a@b.c" }));
    const getToken = await resolveLocalToken(
      "http://api.test/api",
      { WORKOUT_LOGGER_EMAIL: "a@b.c", WORKOUT_LOGGER_PASSWORD: "pw" } as NodeJS.ProcessEnv,
      fetchImpl as unknown as typeof fetch,
    );
    expect(await getToken()).toBe("jwt-xyz");
    expect(fetchImpl.mock.calls[0][0]).toBe("http://api.test/api/auth/login");
  });

  it("throws when no identity is configured", async () => {
    await expect(resolveLocalToken("http://api.test/api", {} as NodeJS.ProcessEnv, vi.fn() as unknown as typeof fetch))
      .rejects.toThrow(/No identity configured/);
  });
});
