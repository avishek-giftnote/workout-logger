import { describe, it, expect, vi, beforeEach } from "vitest";
import { Api, tokenStore } from "./client";

// node test env: stub the browser globals the client touches
const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
});
const mockFetch = (status: number, body: unknown) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({
    status, ok: status >= 200 && status < 300, json: async () => body,
  })));

describe("api client — auth error messages", () => {
  it("a 401 on sign-in is a credentials error (not a session expiry) and keeps any existing token", async () => {
    localStorage.setItem("wl.token", "existing");
    mockFetch(401, { message: "Invalid credentials" });          // backend's bad-login response
    await expect(Api.login("a@b.com", "wrong"))
      .rejects.toMatchObject({ status: 401, message: "Incorrect email or password." });
    expect(tokenStore.get()).toBe("existing");                   // a failed login must NOT clear the token
  });

  it("a 401 on register surfaces as a credentials error too", async () => {
    mockFetch(401, {});
    await expect(Api.register("a@b.com", "pw"))
      .rejects.toMatchObject({ message: "Incorrect email or password." });
  });

  it("a 401 on an authenticated request IS a session expiry — clears the stale token", async () => {
    localStorage.setItem("wl.token", "stale");
    mockFetch(401, {});
    await expect(Api.me())
      .rejects.toMatchObject({ message: "Session expired — please sign in again." });
    expect(tokenStore.get()).toBeNull();                         // stale token cleared
  });

  it("surfaces the server's message for a non-401 error (e.g. duplicate email on register)", async () => {
    mockFetch(409, { message: "Email already registered" });
    await expect(Api.register("a@b.com", "pw"))
      .rejects.toMatchObject({ status: 409, message: "Email already registered" });
  });
});
