import { createContext, useContext, useState, type ReactNode } from "react";
import { ALL_CHART_KEYS } from "./charts";

/** Where the logging screen pulls "last time" values from when seeding sets. */
export type PrevSource = "any" | "template";

interface SettingsCtx {
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
}

const KEY = "wl.settings.prevSource";
const RPE_KEY = "wl.settings.showRpe";
const REST_KEY = "wl.settings.restTarget";
const REST_ON_KEY = "wl.settings.restTimerEnabled";
const CHARTS_KEY = "wl.settings.charts";
const COACH_KEY = "wl.settings.coachEnabled";
const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [prevSource, setPrevState] = useState<PrevSource>(
    () => (localStorage.getItem(KEY) as PrevSource) || "any");
  const setPrevSource = (v: PrevSource) => { localStorage.setItem(KEY, v); setPrevState(v); };

  const [showRpe, setRpeState] = useState<boolean>(
    () => localStorage.getItem(RPE_KEY) !== "false");   // default on
  const setShowRpe = (v: boolean) => { localStorage.setItem(RPE_KEY, String(v)); setRpeState(v); };

  const [restTarget, setRestState] = useState<number>(
    () => { const v = localStorage.getItem(REST_KEY); return v == null ? 90 : parseInt(v, 10) || 0; });
  const setRestTarget = (v: number) => { localStorage.setItem(REST_KEY, String(v)); setRestState(v); };

  const [restTimerEnabled, setRestOnState] = useState<boolean>(
    () => localStorage.getItem(REST_ON_KEY) !== "false");   // default on
  const setRestTimerEnabled = (v: boolean) => { localStorage.setItem(REST_ON_KEY, String(v)); setRestOnState(v); };

  const [charts, setCharts] = useState<string[]>(() => {
    try { const v = localStorage.getItem(CHARTS_KEY); return v ? JSON.parse(v) : ALL_CHART_KEYS; } catch { return ALL_CHART_KEYS; }
  });
  const toggleChart = (key: string) => setCharts((cur) => {
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    localStorage.setItem(CHARTS_KEY, JSON.stringify(next));
    return next;
  });

  const [coachEnabled, setCoachState] = useState<boolean>(() => localStorage.getItem(COACH_KEY) !== "false");
  const setCoachEnabled = (v: boolean) => { localStorage.setItem(COACH_KEY, String(v)); setCoachState(v); };

  return <Ctx.Provider value={{ prevSource, setPrevSource, showRpe, setShowRpe, restTarget, setRestTarget, restTimerEnabled, setRestTimerEnabled, charts, toggleChart, coachEnabled, setCoachEnabled }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
