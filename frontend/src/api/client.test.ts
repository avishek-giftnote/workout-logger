import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Api, tokenStore, setOnUnauthenticated } from "./client";

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

  it("a 401 on a register call surfaces as a credentials error too (not a session expiry)", async () => {
    mockFetch(401, {});
    await expect(Api.register("a@b.com", "password123"))
      .rejects.toMatchObject({ message: "Incorrect email or password." });
  });

  it("a 401 on an authenticated request IS a session expiry — clears the stale token", async () => {
    localStorage.setItem("wl.token", "stale");
    mockFetch(401, {});
    await expect(Api.me())
      .rejects.toMatchObject({ message: "Session expired — please sign in again." });
    expect(tokenStore.get()).toBeNull();                         // stale token cleared
  });

  it("surfaces the server's message for a non-401 error (e.g. a duplicate-email conflict)", async () => {
    mockFetch(409, { message: "Email already registered" });
    await expect(Api.register("a@b.com", "password123"))
      .rejects.toMatchObject({ status: 409, message: "Email already registered" });
  });
});

describe("api client — onUnauthenticated callback", () => {
  afterEach(() => setOnUnauthenticated(() => {})); // always restore the no-op

  it("invokes the registered callback on a mid-session 401 (stale token)", async () => {
    localStorage.setItem("wl.token", "stale");
    const cb = vi.fn();
    setOnUnauthenticated(cb);
    mockFetch(401, {});
    await expect(Api.me()).rejects.toMatchObject({ status: 401 });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does NOT invoke the callback on an auth-endpoint 401 (bad credentials — not a session expiry)", async () => {
    const cb = vi.fn();
    setOnUnauthenticated(cb);
    mockFetch(401, {});
    await expect(Api.login("a@b.com", "wrong")).rejects.toMatchObject({ status: 401 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("does NOT invoke the callback on a non-401 error", async () => {
    const cb = vi.fn();
    setOnUnauthenticated(cb);
    mockFetch(500, { message: "Internal error" });
    await expect(Api.me()).rejects.toMatchObject({ status: 500 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("api client — fail-fast on an unresponsive backend", () => {
  it("aborts a hung request after the timeout and reports the server isn't responding", async () => {
    vi.useFakeTimers();
    try {
      // a fetch that never resolves but rejects on abort — mirrors a real request stuck on a dead backend
      vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) =>
        new Promise((_res, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })));
      const assertion = expect(Api.me())
        .rejects.toMatchObject({ status: 0, message: "Server isn't responding — please try again." });
      await vi.advanceTimersByTimeAsync(12_000);   // trip the AbortController timeout
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a network error when fetch rejects without an HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(Api.me())
      .rejects.toMatchObject({ status: 0, message: "Network error — check your connection and try again." });
  });
});
