import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ALL_CHART_KEYS } from "./charts";
import { openLocalStore } from "./local/sqlite";
import type { LocalStore } from "./local/LocalStore";
import { Api, tokenStore } from "./api/client";

/** Where the logging screen pulls "last time" values from when seeding sets. */
export type PrevSource = "any" | "template";

// Cloud sync is the future subscription feature; ungated in dev. Flip per-entitlement later — this is the
// only subscription seam. The LOCAL base (SQLite via LocalStore) is always on.
const SYNC_ENABLED = true;

interface SettingsCtx {
  ready: boolean;                      // local store hydrated (defaults render until then)
  prevSource: PrevSource;
  setPrevSource: (v: PrevSource) => void;
  showRpe: boolean;
  setShowRpe: (v: boolean) => void;
  restTarget: number;                  // global default rest seconds; 0 = none
  setRestTarget: (v: number) => void;
  restTimerEnabled: boolean;           // master on/off for the rest timer
  setRestTimerEnabled: (v: boolean) => void;
  charts: string[];                    // which graphs to show on exercise/template pages
  toggleChart: (key: string) => void;
  coachEnabled: boolean;               // show the energy-balance Coach card
  setCoachEnabled: (v: boolean) => void;
  dismissedCompletionPlanId: string | null;  // plan id the user already acknowledged; shows completion screen once
  setDismissedCompletionPlanId: (v: string | null) => void;
}

// ── pure settings <-> string serialization (the kv store + the wire are both string→string) ──
export interface SettingsState {
  prevSource: PrevSource; showRpe: boolean; restTarget: number;
  restTimerEnabled: boolean; charts: string[]; coachEnabled: boolean;
  dismissedCompletionPlanId: string | null;
}
export const DEFAULTS: SettingsState = {
  prevSource: "any", showRpe: true, restTarget: 90, restTimerEnabled: true,
  charts: ALL_CHART_KEYS, coachEnabled: true, dismissedCompletionPlanId: null,
};

export function serializeAll(s: SettingsState): Record<string, string> {
  return {
    prevSource: s.prevSource,
    showRpe: String(s.showRpe),
    restTarget: String(s.restTarget),
    restTimerEnabled: String(s.restTimerEnabled),
    charts: JSON.stringify(s.charts),
    coachEnabled: String(s.coachEnabled),
    dismissedCompletionPlanId: s.dismissedCompletionPlanId ?? "",
  };
}

/** Parse a raw string map back into a partial state (missing/invalid keys fall back to the defaults). */
export function deserialize(raw: Record<string, string>): Partial<SettingsState> {
  const out: Partial<SettingsState> = {};
  if (raw.prevSource === "any" || raw.prevSource === "template") out.prevSource = raw.prevSource;
  if (raw.showRpe != null) out.showRpe = raw.showRpe !== "false";
  if (raw.restTarget != null) { const n = parseInt(raw.restTarget, 10); if (!Number.isNaN(n)) out.restTarget = n; }
  if (raw.restTimerEnabled != null) out.restTimerEnabled = raw.restTimerEnabled !== "false";
  if (raw.charts != null) { try { const a = JSON.parse(raw.charts); if (Array.isArray(a)) out.charts = a; } catch { /* keep default */ } }
  if (raw.coachEnabled != null) out.coachEnabled = raw.coachEnabled !== "false";
  if (raw.dismissedCompletionPlanId != null) out.dismissedCompletionPlanId = raw.dismissedCompletionPlanId || null;
  return out;
}

// Legacy localStorage keys (pre-SQLite) → new kv keys, for a one-time migration so existing prefs survive.
export const LEGACY_KEYS: Record<string, keyof SettingsState> = {
  "wl.settings.prevSource": "prevSource",
  "wl.settings.showRpe": "showRpe",
  "wl.settings.restTarget": "restTarget",
  "wl.settings.restTimerEnabled": "restTimerEnabled",
  "wl.settings.charts": "charts",
  "wl.settings.coachEnabled": "coachEnabled",
  // dismissedCompletionPlanId has no legacy key (new field)
};

/** One-time import of legacy localStorage prefs into the local store (no-op once the store has data). The
 *  legacy values are already in the same serialized form, so they copy across verbatim. Returns true if it
 *  migrated anything. */
export function migrateLegacy(store: LocalStore, now: number): boolean {
  if (store.all().size > 0) return false;
  let migrated = false;
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEYS)) {
    const v = localStorage.getItem(oldKey);
    if (v != null) { store.set(newKey, v, now); migrated = true; }
  }
  if (migrated) store.set("__updatedAt", String(now), now);
  return migrated;
}

const rawAll = (store: LocalStore): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, { value }] of store.all()) out[k] = value;
  return out;
};
const writeBlob = (store: LocalStore, s: SettingsState, ts: number) => {
  for (const [k, v] of Object.entries(serializeAll(s))) store.set(k, v, ts);
  store.set("__updatedAt", String(ts), ts);
};

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettingsState>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const storeRef = useRef<LocalStore | null>(null);

  // Hydrate once: open the local store → migrate legacy prefs → read local → reconcile with the server
  // (last-write-wins by updatedAt). Local SQLite is the source of truth; the server is the sync target.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await openLocalStore();
      if (cancelled) return;
      storeRef.current = store;
      migrateLegacy(store, Date.now());
      let merged: SettingsState = { ...DEFAULTS, ...deserialize(rawAll(store)) };
      let localTs = Number(store.get("__updatedAt") ?? "0");

      if (SYNC_ENABLED && tokenStore.get()) {
        try {
          const remote = await Api.getSettings();
          const remoteTs = Number(remote.updatedAt || "0");
          if (remoteTs > localTs) {                         // server is newer → adopt + cache locally
            merged = { ...merged, ...deserialize(remote.settings) };
            writeBlob(store, merged, remoteTs);
          } else if (localTs > remoteTs) {                  // local is newer → push it up
            Api.putSettings({ settings: serializeAll(merged), updatedAt: String(localTs) }).catch(() => {});
          }
        } catch { /* offline / unauthenticated — local stands */ }
      }
      if (!cancelled) { setState(merged); setReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Write-through: update React state, persist the whole blob locally (cheap, synchronous), then push to
  // the server if syncing + authenticated.
  const persist = (next: SettingsState) => {
    setState(next);
    const store = storeRef.current;
    if (!store) return;
    const ts = Date.now();
    writeBlob(store, next, ts);
    if (SYNC_ENABLED && tokenStore.get())
      Api.putSettings({ settings: serializeAll(next), updatedAt: String(ts) }).catch(() => {});
  };
  const update = (patch: Partial<SettingsState>) => persist({ ...state, ...patch });

  const value: SettingsCtx = {
    ready,
    prevSource: state.prevSource, setPrevSource: (v) => update({ prevSource: v }),
    showRpe: state.showRpe, setShowRpe: (v) => update({ showRpe: v }),
    restTarget: state.restTarget, setRestTarget: (v) => update({ restTarget: v }),
    restTimerEnabled: state.restTimerEnabled, setRestTimerEnabled: (v) => update({ restTimerEnabled: v }),
    charts: state.charts,
    toggleChart: (key) => update({ charts: state.charts.includes(key) ? state.charts.filter((k) => k !== key) : [...state.charts, key] }),
    coachEnabled: state.coachEnabled, setCoachEnabled: (v) => update({ coachEnabled: v }),
    dismissedCompletionPlanId: state.dismissedCompletionPlanId,
    setDismissedCompletionPlanId: (v) => update({ dismissedCompletionPlanId: v }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
