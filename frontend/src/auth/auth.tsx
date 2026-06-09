import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { tokenStore } from "../api/client";

interface AuthCtx {
  token: string | null;
  isAuthed: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  const value = useMemo<AuthCtx>(() => ({
    token,
    isAuthed: !!token,
    signIn: (t) => { tokenStore.set(t); setToken(t); },
    signOut: () => { tokenStore.clear(); setToken(null); },
  }), [token]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
