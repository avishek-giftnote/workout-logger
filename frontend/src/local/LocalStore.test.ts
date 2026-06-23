import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { LocalStorageLocalStore, SqliteLocalStore, type LocalStore, type SqliteHandle } from "./LocalStore";

// The same contract must hold for every LocalStore implementation.
function contract(name: string, make: () => LocalStore) {
  describe(`LocalStore contract — ${name}`, () => {
    it("set / get / missing", () => {
      const s = make();
      s.set("coachEnabled", "false", 1000);
      expect(s.get("coachEnabled")).toBe("false");
      expect(s.get("nope")).toBeNull();
    });
    it("upserts on the same key (value + updatedAt)", () => {
      const s = make();
      s.set("k", "a", 1);
      s.set("k", "b", 2);
      expect(s.get("k")).toBe("b");
      expect(s.all().get("k")).toEqual({ value: "b", updatedAt: 2 });
    });
    it("all() returns every key with its updatedAt; remove() deletes", () => {
      const s = make();
      s.set("a", "1", 10);
      s.set("b", "template", 11);
      const all = s.all();
      expect(all.size).toBe(2);
      expect(all.get("b")).toEqual({ value: "template", updatedAt: 11 });
      s.remove("a");
      expect(s.get("a")).toBeNull();
      expect(s.all().size).toBe(1);
    });
  });
}

// 1) SQLite implementation, against an in-memory DB (no OPFS needed — runs in the node test env).
describe("SqliteLocalStore", () => {
  let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
  beforeAll(async () => { sqlite3 = await sqlite3InitModule(); });
  contract("sqlite :memory:", () => new SqliteLocalStore(new sqlite3.oo1.DB(":memory:", "c") as unknown as SqliteHandle));
});

// 2) localStorage fallback, against a stubbed localStorage.
describe("LocalStorageLocalStore", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    });
  });
  contract("localStorage", () => new LocalStorageLocalStore());
});
