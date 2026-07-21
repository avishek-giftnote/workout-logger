import { useState, type FormEvent } from "react";
import { Api, ApiError } from "../api/client";
import { useAuth } from "../auth/auth";

type Mode = "login" | "signup";
type Step = "email" | "verify";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetTo(m: Mode) {
    setMode(m);
    setStep("email");
    setError(null);
    setCode("");
    setPassword("");
    setConfirm("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        const res = await Api.login(email, password);
        signIn(res.token);
      } else if (step === "email") {
        await Api.signupRequest(email);      // always 202; a code is on its way if the email is free
        setStep("verify");
      } else {
        if (password !== confirm) { setError("Passwords do not match."); return; }
        const res = await Api.signupVerify(email, code.trim(), password, confirm);
        signIn(res.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Browser autocomplete hints — attribute values, not credentials.
  const pwAutocomplete = mode === "login" ? "current-password" : "new-password"; // pragma: allowlist secret
  const heading = mode === "login" ? "Welcome back."
    : step === "email" ? "Start lifting." : "Check your email.";
  const sub = mode === "login" ? "Sign in to pick up where you left off."
    : step === "email" ? "Enter your email and we'll send a verification code."
    : `We sent a 6-digit code to ${email}. Enter it and choose a password.`;

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
          {/* Email — shown for login and for the first sign-up step; locked once a code is sent. */}
          {(mode === "login" || step === "email") && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          )}

          {/* Sign-up: verification code. */}
          {mode === "signup" && step === "verify" && (
            <div className="field">
              <label htmlFor="code">Verification code</label>
              <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" required
                value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
            </div>
          )}

          {/* Password — login, or the sign-up verify step (entered twice). */}
          {(mode === "login" || (mode === "signup" && step === "verify")) && (
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" className="input" type="password" required minLength={8}
                autoComplete={pwAutocomplete}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}
          {mode === "signup" && step === "verify" && (
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input id="confirm" className="input" type="password" required minLength={8} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
            </div>
          )}

          {error && <p className="err mt">{error}</p>}

          <button className="btn btn-volt btn-block btn-lg mt" type="submit" disabled={busy}>
            {busy ? "…"
              : mode === "login" ? "Sign in"
              : step === "email" ? "Send code"
              : "Create account"}
          </button>
        </form>

        {mode === "signup" && step === "verify" && (
          <p className="swap">
            Didn't get it?{" "}
            <button type="button" onClick={() => { setStep("email"); setError(null); setCode(""); }}>Use a different email</button>
          </p>
        )}

        <p className="swap">
          {mode === "login" ? "No account yet?" : "Already lifting?"}{" "}
          <button type="button" onClick={() => resetTo(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
