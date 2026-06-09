import { createContext, useContext, useState, type ReactNode } from "react";

/** Where the logging screen pulls "last time" values from when seeding sets. */
export type PrevSource = "any" | "template";

interface SettingsCtx {
  prevSource: PrevSource;
  setPrevSource: (v: PrevSource) => void;
}

const KEY = "wl.settings.prevSource";
const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [prevSource, setState] = useState<PrevSource>(
    () => (localStorage.getItem(KEY) as PrevSource) || "any");
  const setPrevSource = (v: PrevSource) => { localStorage.setItem(KEY, v); setState(v); };
  return <Ctx.Provider value={{ prevSource, setPrevSource }}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
