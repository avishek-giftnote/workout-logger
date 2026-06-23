import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULTS, serializeAll, deserialize, migrateLegacy, type SettingsState } from "./settings";
import { LocalStorageLocalStore } from "./local/LocalStore";

const ls: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(ls)) delete ls[k];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    key: (i: number) => Object.keys(ls)[i] ?? null,
    get length() { return Object.keys(ls).length; },
  });
});

const fromStore = (store: LocalStorageLocalStore) =>
  ({ ...DEFAULTS, ...deserialize(Object.fromEntries([...store.all()].map(([k, v]) => [k, v.value]))) });

describe("settings serialization", () => {
  it("serializeAll → deserialize round-trips every setting", () => {
    const s: SettingsState = {
      prevSource: "template", showRpe: false, restTarget: 120,
      restTimerEnabled: false, charts: ["a", "b"], coachEnabled: false,
    };
    expect({ ...DEFAULTS, ...deserialize(serializeAll(s)) }).toEqual(s);
  });

  it("missing or invalid keys fall back to the defaults", () => {
    expect({ ...DEFAULTS, ...deserialize({}) }).toEqual(DEFAULTS);
    expect(deserialize({ restTarget: "abc" }).restTarget).toBeUndefined();
    expect(deserialize({ charts: "not-json" }).charts).toBeUndefined();
    expect(deserialize({ prevSource: "bogus" }).prevSource).toBeUndefined();
    expect(deserialize({ showRpe: "false" }).showRpe).toBe(false);
    expect(deserialize({ showRpe: "true" }).showRpe).toBe(true);
    expect(deserialize({ restTarget: "0" }).restTarget).toBe(0);     // 0 = "no rest" is a valid value
  });
});

describe("legacy localStorage → SQLite migration", () => {
  it("imports legacy prefs into an empty store, exactly once", () => {
    localStorage.setItem("wl.settings.prevSource", "template");
    localStorage.setItem("wl.settings.coachEnabled", "false");
    localStorage.setItem("wl.settings.charts", JSON.stringify(["x"]));
    const store = new LocalStorageLocalStore("wl.kv.");

    expect(migrateLegacy(store, 1000)).toBe(true);
    const got = fromStore(store);
    expect(got.prevSource).toBe("template");
    expect(got.coachEnabled).toBe(false);
    expect(got.charts).toEqual(["x"]);
    expect(store.get("__updatedAt")).toBe("1000");

    // idempotent: store now has data → a later legacy change is NOT re-imported
    localStorage.setItem("wl.settings.prevSource", "any");
    expect(migrateLegacy(store, 2000)).toBe(false);
    expect(store.get("prevSource")).toBe("template");
  });

  it("no legacy keys → nothing migrated", () => {
    const store = new LocalStorageLocalStore("wl.kv.");
    expect(migrateLegacy(store, 1)).toBe(false);
    expect(store.all().size).toBe(0);
  });
});
