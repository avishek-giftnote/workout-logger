import { createContext, useContext, useState, type ReactNode } from "react";

/** Where the logging screen pulls "last time" values from when seeding sets. */
export type PrevSource = "any" | "template";

interface SettingsCtx {
  prevSource: PrevSource;
  setPrevSource: (v: PrevSource) => void;
  showRpe: boolean;
  setShowRpe: (v: boolean) => void;
  restTarget: number;                  // rest-timer target seconds; 0 = off
  setRestTarget: (v: number) => void;
}

const KEY = "wl.settings.prevSource";
const RPE_KEY = "wl.settings.showRpe";
const REST_KEY = "wl.settings.restTarget";
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

  return <Ctx.Provider value={{ prevSource, setPrevSource, showRpe, setShowRpe, restTarget, setRestTarget }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
