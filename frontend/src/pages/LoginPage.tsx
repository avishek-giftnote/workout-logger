import { useState, type FormEvent } from "react";
import { Api, ApiError } from "../api/client";
import { useAuth } from "../auth/auth";

type Mode = "login" | "register";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function swap(m: Mode) {
    setMode(m);
    setError(null);
    setPassword("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = mode === "login"
        ? await Api.login(email, password)
        : await Api.register(email, password);
      signIn(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Browser autocomplete hints — attribute values, not credentials.
  const pwAutocomplete = mode === "login" ? "current-password" : "new-password"; // pragma: allowlist secret
  const heading = mode === "login" ? "Welcome back." : "Start lifting.";
  const sub = mode === "login"
    ? "Sign in to pick up where you left off."
    : "Create an account with your email and a password.";

  return (
    <div className="auth">
      <div className="card auth-card fade-up">
        <div className="auth-brand">
          <div className="mark" />
          <span className="micro">Strength Log</span>
        </div>
        <h1>{heading}</h1>
        <p className="sub">{sub}</p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" required minLength={8}
              autoComplete={pwAutocomplete}
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>

          {error && <p className="err mt">{error}</p>}

          <button className="btn btn-volt btn-block btn-lg mt" type="submit" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="swap">
          {mode === "login" ? "No account yet?" : "Already lifting?"}{" "}
          <button type="button" onClick={() => swap(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
