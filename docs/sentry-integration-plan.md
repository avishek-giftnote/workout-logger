# Sentry.io integration — implementation plan

*Status: **PLAN, awaiting approval.** Drafted while Avishek was away, so scope was chosen on safe defaults
(below) — confirm or adjust before I execute. This is the durable record; it supersedes the PROGRESS.md
"observability (Sentry/health/uptime)" backlog line once shipped.*

## Goal

Add error monitoring (and light performance tracing) to the Spring Boot backend and the React frontend via
Sentry.io SaaS, **without leaking this app's health/PII data** (bodyweight, email) or its **JWTs** (sent as a
`Bearer` header, stored in `localStorage`). Error capture must be **precise** — real server 500s and client
crashes only, never the expected 4xx client errors the app already handles.

## Decisions taken (defaults — confirm)

| Decision | Choice | Why |
|---|---|---|
| Scope | **Backend + frontend** | Complete picture; already the backlog item. |
| Capabilities | **Errors + light tracing (`tracesSampleRate` 0.1 prod / 0 dev)**; **Session Replay ON, privacy-masked** | Avishek opted in. Replay records the DOM, so it runs in max-privacy mode: `maskAllText`, `maskAllInputs`, `blockAllMedia`, no network-body capture. Residual: layout/clicks/nav are recorded, and masking is client-side (trust-but-verify — see Verification). |
| DSN / account | **Wire everything to env; DSN added later** | Nothing sensitive in git/chat. Code no-ops cleanly when DSN is unset (dev/CI stay silent). |
| PII | **`sendDefaultPii: false` + active scrubbing** of `Authorization`/`Cookie`/token strings, no request bodies | Non-negotiable given health data + JWTs. |
| Release grouping | **git SHA** on both sides | Errors group per deploy; JS sourcemaps + Java line numbers resolve. |

**Open questions for Avishek** (don't block Stage A):
1. Do you have a Sentry org + **two projects** (one backend `java-spring-boot`, one frontend `javascript-react`), or should I give you the exact create steps? Two DSNs total.
2. ~~Session Replay?~~ **Resolved: ON, privacy-masked** (mask all text + inputs, block media). Verify masking on a real replay before trusting it with prod PII.
3. For source-map upload you'll need a **`SENTRY_AUTH_TOKEN`** (org-scoped, `project:releases` scope). That's the one real secret — it goes in CI secrets / local `.env`, never committed or pasted in chat.

## Pinned versions (verified July 2026)

- Backend: `io.sentry:sentry-spring-boot-starter-jakarta:8.47.0` (v8 line; OpenTelemetry-based tracing is bundled/agentless for a plain Spring Boot app).
- Frontend: `@sentry/react@10.63.0`, `@sentry/vite-plugin@5.3.0`. **Do not pin `@sentry/*` below 10.27.0** — advisory GHSA-6465-jgvq-jhgp (Authorization/Cookie leak under `sendDefaultPii:true`) is patched at 10.27.0; we're above it and PII is off, so unaffected.

---

## Stage A — Backend ✅ BUILT + verified 2026-07-07 (not yet shipped)

*Implemented as below; full backend gate green (123 tests incl. `RUN_MONGO_TESTS=1`, context boots with the
Sentry autoconfig present + DSN blank). `ApiExceptionHandlerSentryTest` pins 500→1 event / 4xx→0.*

### A1. Dependency — `backend/pom.xml`
```xml
<dependency>
  <groupId>io.sentry</groupId>
  <artifactId>sentry-spring-boot-starter-jakarta</artifactId>
  <version>8.47.0</version>
</dependency>
```

### A2. Config — `backend/src/main/resources/application.yml`
Append a block, following the existing `${ENV:default}` style. A blank DSN keeps the SDK disabled (safe in
dev/test/CI):
```yaml
sentry:
  dsn: ${SENTRY_DSN:}                 # empty => SDK disabled
  environment: ${SENTRY_ENVIRONMENT:local}
  release: ${SENTRY_RELEASE:}         # git SHA at deploy
  traces-sample-rate: ${SENTRY_TRACES_SAMPLE_RATE:0}   # 0 in dev; set 0.1 in prod .env
  send-default-pii: false             # explicit (also the default)
  # NOTE: max-request-body-size defaults to NONE — request bodies are NOT captured. Leave it.
```

### A3. Capture design — the surgical part
**Do NOT rely on the auto `SentryExceptionResolver`** (its order relative to the app's `@ExceptionHandler`s
is undocumented, and `ignored-exceptions-for-type` would need a fragile list of nested `$` class names + all
the Spring exceptions mapped to 4xx). Instead, capture **explicitly in the one place a genuine 500 is born** —
the generic fallback handler in `web/error/ApiExceptionHandler.java`, which already logs it:
```java
// generic(Exception e): last-resort 500 handler
@ExceptionHandler(Exception.class)
public ResponseEntity<Map<String, Object>> generic(Exception e) {
    log.error("Unhandled exception → 500", e);
    io.sentry.Sentry.captureException(e);   // ONLY here → inherently 500-only
    return body(HttpStatus.INTERNAL_SERVER_ERROR, "Internal error", null);
}
```
Every 4xx (`NotFoundException`→404, `BadRequestException`→400, `ConflictException`→409, `DuplicateKeyException`
/`OptimisticLockingFailureException`→409, validation→400, `AccessDeniedException`→403, `ResponseStatusException`)
is caught by a more specific `@ExceptionHandler` that returns **before** reaching `generic()`, so it is never
captured. No config needed to exclude them.

If the auto-resolver turns out to ALSO fire (double events), the A5 test catches it; the fix is to set
`sentry.exception-resolver-order: 2147483647` (lowest precedence — runs after the advice, which handles
everything, so it never sees an unhandled exception) or disable it. Decide by the test, not by guessing.

### A4. PII defense-in-depth — a `beforeSend` bean (`config/SentryConfig.java`, new)
Defaults already omit IP/cookies/PII headers and scrub `Authorization` by default, but be explicit so a future
`send-default-pii` flip can't silently leak:
```java
@Configuration
class SentryConfig {
  @Bean
  SentryOptions.BeforeSendCallback scrubPii() {
    return (event, hint) -> {
      if (event.getRequest() != null) {
        event.getRequest().setCookies(null);
        var h = event.getRequest().getHeaders();
        if (h != null) { h.remove("Authorization"); h.remove("Cookie"); }
        event.getRequest().setData(null);   // never send request body
      }
      return event;
    };
  }
}
```
(If the starter prefers wiring via `@Bean Sentry.OptionsConfiguration<SentryOptions>` instead of a
`BeforeSendCallback` bean, use that form — confirm against 8.47.0 at implementation.)

### A5. Guard test (decision → executable guard) — `ApiIntegrationTest` or a new `SentryCaptureTest`
Register a stub `BeforeSendCallback` / test transport that **counts** events, then:
- Hit endpoints that throw each 4xx (unknown workout → 404, bad body → 400, dup → 409). Assert **0** captured.
- Force a 500 (a test-only controller or a mocked repo that throws `RuntimeException`). Assert **exactly 1**.

This pins "500-only, single event" so a future refactor or an auto-resolver change can't regress it silently.
Runs in `mvn test` (no real DSN — the stub transport intercepts).

### A6. Gate
`mvn test` + `RUN_MONGO_TESTS=1 mvn test` (touches the web layer). Confirm the app still boots with a blank DSN.

---

## Stage B — Frontend ✅ BUILT + verified 2026-07-07 (not yet shipped)

*Implemented as below (init extracted to `src/sentry.ts`, called from `main.tsx`; `App.tsx` uses
`withSentryReactRouterV6Routing`; `ErrorBoundary.componentDidCatch` reports; `vite.config.ts` gates the
source-map plugin on `SENTRY_AUTH_TOKEN`; `src/vite-env.d.ts` types the env vars). Session Replay ON in
max-privacy mode. Gate green: `tsc --noEmit` clean, 139 unit tests pass, `npm run build` succeeds (DSN baked
in, no maps emitted without the token). Runtime smoke: an uncaught error fired a correct envelope POST to the
frontend project's ingest endpoint (`sentry.javascript.react/10.63.0`) — dashboard arrival + replay masking to
be eyeballed by Avishek.*

### B1. Dependencies — `frontend/`
```
npm install --save @sentry/react@10.63.0
npm install --save-dev @sentry/vite-plugin@5.3.0
```

### B2. Init — `src/main.tsx` (before `createRoot(...).render`)
Guarded so it no-ops when the DSN is unset (dev). Their app uses `<BrowserRouter>` + `<Routes>` (not a data
router), so use the browser-tracing integration + `withSentryReactRouterV6Routing` in `App.tsx`:
```ts
import * as Sentry from "@sentry/react";
import React from "react";
import { useLocation, useNavigationType, createRoutesFromChildren, matchRoutes } from "react-router-dom";

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect: React.useEffect, useLocation, useNavigationType,
        createRoutesFromChildren, matchRoutes,
      }),
      Sentry.replayIntegration({
        maskAllText: true,        // bodyweight/email/notes → masked blocks
        maskAllInputs: true,      // every form field masked
        blockAllMedia: true,
        // no networkDetailAllowUrls → request/response bodies NOT recorded
      }),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 0,
    // Session Replay: sample 10% of normal sessions, but ALWAYS capture the replay around an error.
    replaysSessionSampleRate: import.meta.env.PROD ? 0.1 : 0,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: false,
    beforeBreadcrumb: (c) => {
      if ((c.category === "fetch" || c.category === "xhr") && c.data) {
        delete (c.data as any).request_headers; delete (c.data as any).Authorization;
      }
      return c;
    },
    beforeSend: (event) => {
      const h = event.request?.headers as Record<string, string> | undefined;
      if (h) { delete h["Authorization"]; delete h["Cookie"]; }
      return event;
    },
  });
}
```
`App.tsx`: `const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes)` and render `<SentryRoutes>` in
place of `<Routes>` (keeps route-level tracing tied to their existing route table).

### B3. Wire the EXISTING `ErrorBoundary` (don't replace it)
Keep `components/ErrorBoundary.tsx` and its fallback UI; just report from `componentDidCatch`:
```ts
import * as Sentry from "@sentry/react";
// inside componentDidCatch(error, info):
Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
```
Uncaught errors / unhandled rejections are auto-captured by the SDK's global handlers. Optionally add
TanStack Query `QueryCache({ onError })` → `captureException` if we want failed-query visibility (defer;
most surface as handled `ApiError` already).

### B4. Source maps — `frontend/vite.config.ts` (CONDITIONAL, so CI build never breaks)
Only add the plugin when `SENTRY_AUTH_TOKEN` is present (release builds); plain `npm run build` in CI without
the token is unaffected:
```ts
import { sentryVitePlugin } from "@sentry/vite-plugin";
const sentryPlugins = process.env.SENTRY_AUTH_TOKEN
  ? [sentryVitePlugin({
      org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,   // pragma: allowlist secret (env var reference, not a literal)
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
    })]
  : [];
export default defineConfig({
  build: { sourcemap: "hidden" },          // generate maps, don't reference them in the bundle
  plugins: [react(), ...sentryPlugins],    // sentry plugin LAST
  // ...existing optimizeDeps / server / preview / test config unchanged
});
```

### B5. Gate
`npx tsc --noEmit` + `npm test` + `npm run build` (must pass with **no** `VITE_SENTRY_DSN` and **no**
`SENTRY_AUTH_TOKEN` — the guards make both optional). `npm run e2e` unaffected.

---

## Stage C — Config, secrets, ops ✅ BUILT + verified 2026-07-07 (not yet shipped)

*Wired into the **Docker build** (the actual shipped artifact — CI's gate build isn't deployed, so uploading
maps there would produce mismatched maps). `Dockerfile` Stage 1 takes `VITE_SENTRY_DSN`/`VITE_SENTRY_RELEASE`/
`SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` as **build args** (Railway's builder rejects secret mounts; the token lands in `docker history`, so keep the image
layer); `docker-compose.yml` passes them (secret sourced from the `SENTRY_AUTH_TOKEN` env) + sets backend
runtime `SENTRY_*`; `.env.example` + `DEPLOY.md` document all vars (build-time vs runtime) and the
`SENTRY_RELEASE=$(git rev-parse --short HEAD)` deploy step. `docker compose config` validates; the frontend
Docker stage builds green.*

> **Pre-existing bug found + fixed (unrelated to Sentry).** Building the frontend Docker stage surfaced a
> latent breakage: `npm run build` ran `tsc` over `coach.eval.test.ts`, which imports
> `../../backend/...default-exercises.json` — a path absent in the frontend-only Docker context, so the deploy
> build had been broken since PR #26 (never caught; deploy was never executed). Fix: a build-scoped
> `tsconfig.build.json` that excludes test files, so `npm run build` typechecks production code and works in
> Docker, while `npm run typecheck` stays full (tests included) locally/CI. Not a Sentry change, but it blocked
> Stage C's Docker path.

### Original plan (as implemented):

- **`.env.example`** (root, committed template) — add, commented:
  `SENTRY_DSN=`, `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE=`, `SENTRY_TRACES_SAMPLE_RATE=0.1`,
  `VITE_SENTRY_DSN=`, and (build-only, secret) `SENTRY_AUTH_TOKEN=`, `SENTRY_ORG=`, `SENTRY_PROJECT=`.
- **`.gitignore`** already ignores `.env` / `.env.*` (keeps `.env.example`) — nothing to change.
- **`DEPLOY.md`** — add a Sentry row to the env-var table + note the two DSNs and that release = git SHA
  (`SENTRY_RELEASE=$(git rev-parse --short HEAD)` at build; frontend passes it as `VITE_SENTRY_RELEASE`).
- **CI (`.github/workflows/ci.yml`)** — no change required for the gate to stay green (guards make Sentry
  optional). *Later*, for a real release pipeline: add `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` as
  repo secrets and set `VITE_SENTRY_RELEASE`/`SENTRY_RELEASE` from the commit SHA on the build job.
- **Secrets recap:** only `SENTRY_AUTH_TOKEN` is a hard secret (blocked by the global pre-commit scanner if
  committed). DSNs are public; `SENTRY_ORG`/`SENTRY_PROJECT` are slugs.

## Verification (end-to-end, once a DSN exists)
1. Backend: temporary `throw new RuntimeException("sentry smoke")` behind a dev-only endpoint → confirm one
   event in the Sentry backend project, with **no** `Authorization` header / body in the payload. Remove it.
2. Frontend: a dev-only "throw" button → confirm the client event, the `ErrorBoundary` fallback renders, and
   the breadcrumb trail has **no** token strings.
2b. **Session Replay masking check (mandatory before prod PII):** open the replay attached to the test error
   and confirm bodyweight values, email, and all input fields render as **masked blocks** (`***`), and no
   request/response bodies are captured. If anything shows through, escalate masking (`maskAllText` is on;
   add element-level `data-sentry-mask` / `.sentry-mask` where needed) before pointing a real prod DSN at it.
3. Confirm a 404/400/409 request produces **no** Sentry event (the A5 test already asserts this).

## Suggested execution order
- **Stage A first** — fully self-contained, and the guard test passes with no real DSN. Lands the highest-value
  half (server 500 visibility) behind a gate.
- **Stage B** next (needs `npm install`).
- **Stage C** + live verification once you've created the projects and dropped the DSNs/token into `.env`.

Each stage ships as its own gated PR (backend / frontend / ops) rather than one big change.
