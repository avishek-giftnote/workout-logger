# DEPLOY.md — workout-logger

How to deploy the app as a **single jar** (the Spring Boot backend serves both the `/api` and the bundled
React SPA from one origin) to **Fly.io**, backed by the existing **MongoDB Atlas** cluster.

**Architecture note:** auth (register/login) and all workout logging go through the backend → MongoDB. Only
the *settings* slice is local-first. So the deployed app needs the Atlas connection to work *from Fly*. There
is no cloud-sync / Stripe layer yet (future Phase 2).

---

## What's already done (code — shipped PRs #23/#24)

| Blocker | Status |
|---|---|
| SPA served from the jar + client-side deep links (`/start`, `/previous-workouts/{id}`) don't 404 | ✅ `SpaForwardController` + `SecurityConfig` (`/api/**` auth, rest public) |
| Health check for Fly | ✅ `spring-boot-starter-actuator`, only `/actuator/health` exposed |
| Single-image build that bundles the SPA into the jar | ✅ `Dockerfile` (proven: `static/index.html` is inside the jar) |
| `fly.toml` / `.dockerignore` | ✅ committed (no secrets) |
| Blank `SECURITY_JWT_SECRET` silently degrading | ✅ M7 fail-fast under the `prod` profile (`SPRING_PROFILES_ACTIVE=prod` set in `fly.toml`) |
| Client API base URL | ✅ relative `/api` → same-origin, no CORS, no `VITE_API_URL` |

The remaining work is **operational** — accounts, secrets, and dashboards only you can touch.

---

## Manual prerequisites (do these first — in order)

1. **Fly.io account + CLI** — install `flyctl`, then `fly auth login` (browser). Add a payment card
   (https://fly.io/dashboard → Billing) — required even on the free allowance.
2. **Atlas → Network Access → allow Fly to connect.** Add `0.0.0.0/0` (allow from anywhere). Atlas M0 has no
   PrivateLink and Fly egress IPs are dynamic, so this is the pragmatic option. **Without it the deployed app
   hangs on "connection timed out" and register/login fail — the #1 silent killer.**
3. **Rotate the Atlas DB password** (recommended). The `avishek_db_user` password was exposed in a chat
   transcript. Atlas → Database Access → edit user → Edit Password → autogenerate → copy the new **SRV
   connection string**.
4. **Generate a JWT secret:** `openssl rand -base64 48` — keep the output for step 7. (Because of M7, a blank
   secret now makes the prod container **refuse to boot**, so this is mandatory, not optional.)
5. **Verify the prod `workoutlogger` DB is clean** before first boot: no duplicate emails, no >1 ACTIVE plan.
   The app builds unique indexes at startup (`SchemaBootstrap`) and **fail-fasts on a dirty DB**. (The importer
   already built these on the real data, so it should be clean — just confirm.)

---

## Deploy (Phase 1 — web app live)

From the repo root (the `Dockerfile` + `fly.toml` are here):

```bash
# 1. Create the Fly app (generates/overwrites fly.toml with a unique name + region; --no-deploy yet)
fly launch --no-deploy
#    (or keep the committed fly.toml and just `fly apps create <name>`; ensure app name + region are set)

# 2. Set secrets (NEVER commit these — injected at deploy time)
fly secrets set MONGODB_URI="mongodb+srv://...<your rotated string>..." \
                SECURITY_JWT_SECRET="<the openssl output from step 4>"

# 3. Deploy (builds the Dockerfile remotely, bundles the SPA, boots on :8080 behind HTTPS)
fly deploy --remote-only

# 4. Open it
fly open
```

The first request after an idle period has a JVM cold-start (a few seconds) because `fly.toml` is set to
scale-to-zero (`min_machines_running = 0`). Bump it to `1` if you want it always warm.

### Smoke-test after deploy
- `https://<app>.fly.dev/` loads the SPA; a hard refresh on `/start` still loads (no 404).
- Register a new account → log a workout → refresh → it persists (proves Atlas connectivity + auth).
- `https://<app>.fly.dev/actuator/health` returns `{"status":"UP"}`.

---

## Optional — continuous deploy on merge to main

Add a `deploy` job to `.github/workflows/ci.yml` gated on `needs: [frontend-gate, backend-gate, e2e]` and
`if: github.ref == 'refs/heads/main' && github.event_name == 'push'`, using
`superfly/flyctl-actions/setup-flyctl` + `fly deploy --remote-only` with `FLY_API_TOKEN`. Create the token
with `fly tokens create deploy` and add it to GitHub repo secrets. Consider restricting to backend/frontend
path changes so docs-only merges don't redeploy.

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | ✅ | Atlas SRV string — `fly secrets set` |
| `SECURITY_JWT_SECRET` | ✅ | 32+ random bytes. **Blank → container refuses to boot under the prod profile (M7).** |
| `SPRING_PROFILES_ACTIVE` | ✅ (set in `fly.toml`) | `prod` — engages the M7 fail-fast |
| `SECURITY_JWT_EXPIRY_MINUTES` | optional | default 10080 (7 days) |
| `SECURITY_RATELIMIT_ENABLED` | optional | default `true`; in-memory, single-VM (fine for Phase 1) |

---

## Known limitations (revisit before scaling)

- **Rate limiter + draft state are in-memory** — correct for a single Fly VM; 2+ instances need a shared store
  (Fly Redis). `min_machines_running = 0` is fine (the limiter just resets on cold start).
- **Atlas M0** — shared, no SLA, 512MB, max 500 connections. Budget M10 as the first paid upgrade.
- **512MB VM** — JVM runs with `-XX:MaxRAMPercentage=75`; watch memory under load, bump to 1GB if it OOM-kills.
- **No observability** — `fly logs` + Fly metrics to start; add structured (JSON) logging before scaling.
- **No data-migration story** — a schema-shape change currently means re-import into a fresh DB; design a
  migration path before there's real user data to preserve.
- **Phase 2 (deferred):** Stripe + a `subscribed` flag + a `403` sync-gate + delta-sync over the existing REST
  API (the local-first `LocalStore` seam already exists client-side).

_Last updated: 2026-06-30 — blockers fixed in PRs #23/#24._
