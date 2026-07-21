import { useState, type FormEvent } from "react";
import { Api, ApiError } from "../api/client";
import { useAuth } from "../auth/auth";

type Mode = "login" | "signup" | "recover";
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
        // Both flows are enumeration-neutral: always 202, a code is on its way only if the email is eligible.
        if (mode === "signup") await Api.signupRequest(email);
        else await Api.recoverRequest(email);
        setStep("verify");
      } else {
        if (password !== confirm) { setError("Passwords do not match."); return; }
        const res = mode === "signup"
          ? await Api.signupVerify(email, code.trim(), password, confirm)
          : await Api.recoverVerify(email, code.trim(), password, confirm);
        signIn(res.token);   // recovery signs the device in and revokes every other session
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Browser autocomplete hints — attribute values, not credentials.
  const pwAutocomplete = mode === "login" ? "current-password" : "new-password"; // pragma: allowlist secret
  const verifying = mode !== "login" && step === "verify";
  const heading = mode === "login" ? "Welcome back."
    : mode === "recover"
      ? (step === "email" ? "Retake ownership." : "Check your email.")
      : (step === "email" ? "Start lifting." : "Check your email.");
  const sub = mode === "login" ? "Sign in to pick up where you left off."
    : step === "verify" ? `We sent a 6-digit code to ${email}. Enter it and choose a ${mode === "recover" ? "new " : ""}password.`
    : mode === "recover" ? "Enter your account email and we'll send a recovery code."
    : "Enter your email and we'll send a verification code.";
  const submitLabel = busy ? "…"
    : mode === "login" ? "Sign in"
    : step === "email" ? "Send code"
    : mode === "recover" ? "Reset password"
    : "Create account";

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
          {/* Email — shown for login and for the first request step of sign-up / recovery; locked once a code is sent. */}
          {(mode === "login" || step === "email") && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" required
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          )}

          {/* Verification / recovery code. */}
          {verifying && (
            <div className="field">
              <label htmlFor="code">{mode === "recover" ? "Recovery code" : "Verification code"}</label>
              <input id="code" className="input mono" inputMode="numeric" autoComplete="one-time-code" required
                value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" />
            </div>
          )}

          {/* Password — login, or the verify step of sign-up / recovery (entered twice). */}
          {(mode === "login" || verifying) && (
            <div className="field">
              <label htmlFor="password">{mode === "recover" ? "New password" : "Password"}</label>
              <input id="password" className="input" type="password" required minLength={8}
                autoComplete={pwAutocomplete}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}
          {verifying && (
            <div className="field">
              <label htmlFor="confirm">Confirm password</label>
              <input id="confirm" className="input" type="password" required minLength={8} autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" />
            </div>
          )}

          {error && <p className="err mt">{error}</p>}

          <button className="btn btn-volt btn-block btn-lg mt" type="submit" disabled={busy}>{submitLabel}</button>
        </form>

        {verifying && (
          <p className="swap">
            Didn't get it?{" "}
            <button type="button" onClick={() => { setStep("email"); setError(null); setCode(""); }}>Use a different email</button>
          </p>
        )}

        {/* Forgot-password entry point, only from the login screen. */}
        {mode === "login" && (
          <p className="swap">
            Forgot your password?{" "}
            <button type="button" onClick={() => resetTo("recover")}>Retake ownership</button>
          </p>
        )}

        <p className="swap">
          {mode === "login" ? "No account yet?" : mode === "recover" ? "Remembered it?" : "Already lifting?"}{" "}
          <button type="button" onClick={() => resetTo(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
