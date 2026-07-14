# DEPLOY.md — workout-logger

The app is **live on [Railway](https://railway.com)** at **`https://workout-logger.up.railway.app`**, deployed as
a **single Docker image** (the Spring Boot backend serves both `/api` and the bundled React SPA from one origin),
with **MongoDB Atlas** as the database and **Sentry** on both ends.

```
Browser ──TLS──▶ Railway edge ──▶ app container (binds $PORT) ──▶ MongoDB Atlas
                                        │
                                        └──▶ Sentry (backend 500s · frontend errors + masked Replay)
```

**Why this shape:** Railway builds the repo's `Dockerfile` straight from GitHub on every push to `main` — no VM,
no SSH, no reverse proxy, no TLS to manage. One origin means no CORS. The backend is pure-JVM on multi-arch base
images, so the build architecture is a non-issue.

| Thing | Value |
|---|---|
| URL | `https://workout-logger.up.railway.app` |
| Railway project / service | `successful-nurturing` / `workout-logger` |
| Database | MongoDB Atlas, DB **`workoutlogger_prod`** (isolated from dev) |
| Spring profile | `prod` (fail-fasts on a blank JWT secret; disables the `!prod` `DebugController`) |
| Health check | `/actuator/health` → `{"status":"UP"}` |

---

## What's in the repo

| File | Purpose |
|---|---|
| `Dockerfile` | The build Railway runs. 3 stages: Vite SPA → bundled into the Spring Boot jar → slim JRE runtime. |
| `.env.example` | Reference for every env var (runtime + build-time). In prod these are set in Railway's Variables tab. |

**Railway is the only deployment path.** There is no compose stack, no VM, no tunnel, and no second target to
keep in sync — if you're adding infrastructure, it goes through Railway.

The app already: serves the SPA + client-side deep links, returns **404 JSON on unknown `/api/*` routes** (PR #44),
404s missing static assets instead of 500ing (PR #40), exposes only `/actuator/health`, calls the API at the
relative `/api`, and **binds Railway's injected `$PORT`** (PR #37).

---

## Configuration

Railway injects `PORT` itself. Everything else is set in the service's **Variables** tab. The split matters:
**runtime** vars are read by the running JVM; **build-time** vars must exist when the image is built, because they
get baked into the JS bundle.

### Runtime (backend)
| Var | Notes |
|---|---|
| `MONGODB_URI` | Atlas SRV string, pointing at `workoutlogger_prod`. |
| `SECURITY_JWT_SECRET` | **Mandatory** — ≥32 bytes (`openssl rand -base64 48`). Blank refuses to boot under `prod`. |
| `SPRING_PROFILES_ACTIVE` | `prod` |
| `SENTRY_DSN` | Backend DSN. Blank ⇒ Sentry off. |
| `SENTRY_ENVIRONMENT` | `production` |
| `SENTRY_TRACES_SAMPLE_RATE` | e.g. `0.1` |

### Build-time (frontend, baked into the bundle)
| Var | Notes |
|---|---|
| `VITE_SENTRY_DSN` | Frontend DSN. **Railway maps a service variable onto a matching `ARG` in the Dockerfile** — that's how it reaches the Vite build. |
| `SENTRY_AUTH_TOKEN` | *Optional*; enables source-map upload (de-minified stack traces). **Currently unset** — see Known limitations. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Only needed alongside the auth token. |

---

## One-time setup

1. **Railway** — New Project → Deploy from GitHub repo → pick `workout-logger`. Railway detects the `Dockerfile`.
   Generate a domain under Settings → Networking.
   > ⚠️ Renaming the service **changes the generated domain** (this one was renamed `modest-balance` →
   > `workout-logger` mid-setup, which moved the URL).
2. **MongoDB Atlas** — create the `workoutlogger_prod` database, then **Network Access → allow Railway's egress**.
   Railway does not offer static egress IPs on the default plan, so in practice this is `0.0.0.0/0` unless you're
   on a plan that does. Skip it and the app boots but every query fails on a TLS/connection reject.
3. **JWT secret** — `openssl rand -base64 48` → `SECURITY_JWT_SECRET`.
4. **Sentry** *(optional)* — two projects (`workout-logger-backend`, `workout-logger-frontend`); copy each DSN into
   the vars above. DSNs are public values; only `SENTRY_AUTH_TOKEN` is a real secret.

## Deploy

**Push to `main`.** Railway rebuilds and redeploys automatically — there is no manual deploy step. Roll back by
redeploying a previous deployment from the Railway dashboard.

## Smoke-test

```bash
curl -s  https://workout-logger.up.railway.app/actuator/health                        # {"status":"UP"}
curl -so /dev/null -w '%{http_code}\n' https://workout-logger.up.railway.app/         # 200 (SPA)
curl -so /dev/null -w '%{http_code}\n' https://workout-logger.up.railway.app/start    # 200 (deep link, not 404)
curl -so /dev/null -w '%{http_code}\n' https://workout-logger.up.railway.app/api/me   # 401 (auth enforced)
```
Then register → log a workout → refresh → it persists (proves Atlas + auth end-to-end).

---

## Railway gotchas (each of these cost real debugging — don't re-learn them)

1. **Bind `$PORT`.** Railway injects it; a hardcoded 8080 receives no traffic. Handled by
   `server.port: ${PORT:8080}` in `application.yml`, which still defaults to 8080 off-Railway.
2. **Railway's builder rejects BuildKit secret mounts** (`--mount=type=secret`; only `type=cache` works). So
   `SENTRY_AUTH_TOKEN` is passed as a plain build **`ARG`**. Trade-off: a build ARG is recorded in
   `docker history`, so keep the image private and use a short-lived `project:releases`-scoped token.
3. **A Railway variable *reference* `${{RAILWAY_GIT_COMMIT_SHA}}` silently resolves to `""`.** It resolves against
   the service's *configured* variables, where no `RAILWAY_GIT_*` exists. Declare `ARG RAILWAY_GIT_COMMIT_SHA` in
   the Dockerfile instead — the builder then passes the real SHA through. This is what makes Sentry releases group
   per deploy.
4. **An empty-but-set variable defeats a Spring default.** `${SENTRY_RELEASE:${RAILWAY_GIT_COMMIT_SHA:}}` only
   falls back when the var is *absent* — a blank one wins and you get no release tag. Delete blank vars from the
   service rather than setting them empty.

---

## Ops & known limitations

- **Source maps are off** (no `SENTRY_AUTH_TOKEN`), so frontend stack traces stay minified. Setting it would expose
  the token in build logs + `docker history` — a standing trade-off, not an oversight.
- **Rate limiter + in-progress draft state are in-memory** — correct for one instance; scaling out needs a shared
  store (Redis).
- **Atlas network access is broad** (see setup step 2) — tighten to static egress IPs if the plan allows.
- **Atlas M0** — shared, no SLA, 512 MB, limited/no automated backup. For real data, schedule `mongodump` or
  upgrade the tier.
- **No data-migration story** — a schema-shape change currently means re-importing into a fresh DB. Design a
  migration path before there is real user data to preserve.
- **Phase 2 (deferred):** Stripe + a `subscribed` flag + a `403` sync-gate + delta-sync over the existing REST API
  (the local-first `LocalStore` seam already exists client-side).

_Last updated: 2026-07-14 — Railway is the sole deployment path; all other deploy tooling has been removed._
