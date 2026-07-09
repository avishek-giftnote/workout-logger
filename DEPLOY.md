# DEPLOY.md — workout-logger

Deploy the app as a **single Docker image** (the Spring Boot backend serves both `/api` and the bundled React
SPA from one origin) onto an **Oracle Cloud Infrastructure (OCI) Always-Free Ampere A1 VM**, fronted by a
**Cloudflare Tunnel** for TLS, with **MongoDB Atlas** as the database.

```
Browser ──TLS──▶ Cloudflare edge ──encrypted tunnel──▶ cloudflared ──▶ app:8080 ──▶ MongoDB Atlas
                                          (both containers on one OCI VM, Docker network)
```

**Why this shape:** the Ampere A1 free tier is generous (up to 4 Arm OCPU / 24 GB RAM, always-on). The
Cloudflare Tunnel means the app publishes **no inbound ports** — nothing is exposed to the internet and you
**don't touch the OCI ingress firewall at all** (its double-layer firewall is the usual footgun). The backend
is pure-JVM on multi-arch base images, so **ARM64 is a non-issue**.

**Architecture note:** auth + workout logging go through the backend → MongoDB (only the *settings* slice is
local-first), so the VM must reach Atlas. No cloud-sync / Stripe layer yet (future Phase 2).

---

## What's in the repo

| File | Purpose |
|---|---|
| `Dockerfile` | 3-stage build: Vite SPA → bundled into the Spring Boot jar → slim JRE runtime (+ `HEALTHCHECK` on `/actuator/health`). Builds natively on ARM. |
| `docker-compose.yml` | Two services: `app` (no published host ports) + `cloudflared` (the tunnel). |
| `.env.example` | Template for the VM's `.env` (secrets). Copy to `.env`, never commit. |

The app already: serves the SPA + client-side deep links, exposes only `/actuator/health`, calls the API at the
relative `/api` (same origin → no CORS), and **fail-fasts on a blank `SECURITY_JWT_SECRET` under the `prod`
profile** (M7 — set in compose).

---

## One-time setup (manual — accounts & dashboards)

### 1. Provision the OCI VM
- Create an OCI account (free; needs a card for identity, not charged on Always-Free).
- Compute → Instances → Create. Shape: **VM.Standard.A1.Flex** (Ampere), e.g. **1–2 OCPU / 6–12 GB**. Image:
  **Ubuntu 22.04** (or Oracle Linux). Add your SSH public key.
  - ⚠️ **Capacity:** "Out of host capacity" on Ampere A1 is common. Retry, try a different Availability Domain,
    or a less-busy home region. (Many people script the create-retry.)
- Networking → reserve the instance's **public IP** (promote the ephemeral IP to *reserved*) so it survives a
  stop/start — you'll allowlist it in Atlas.

### 2. Install Docker on the VM
```bash
ssh ubuntu@<VM_PUBLIC_IP>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && exit        # re-login so the group applies
```
(No inbound firewall rules are needed — the tunnel is outbound-only. Leave the OCI Security List default and
don't add host iptables rules beyond SSH.)

### 3. Cloudflare Tunnel
- Put a domain on Cloudflare (free plan — change the domain's nameservers to Cloudflare).
- Zero Trust dashboard → **Networks → Tunnels → Create a tunnel → Cloudflared**. Name it; copy the **tunnel
  token** (shown in the `--token <...>` of the install command) — that's `TUNNEL_TOKEN`.
- In the tunnel's **Public Hostname** tab, add: `app.yourdomain.com` → Service `HTTP` → `http://app:8080`
  (the compose service name `app`, port 8080).

### 4. MongoDB Atlas
- Network Access → add the VM's **reserved public IP** (a single `/32` — tighter than the `0.0.0.0/0` Fly would
  have forced).

### 5. JWT secret
```bash
openssl rand -base64 48        # → SECURITY_JWT_SECRET (mandatory; blank won't boot under prod)
```

### 6. Sentry (optional — error monitoring)
Create two sentry.io projects — `workout-logger-backend` (Spring Boot) + `workout-logger-frontend` (React) —
and copy each **DSN**. For de-minified frontend stack traces, create an **org auth token** (`project:releases`)
= `SENTRY_AUTH_TOKEN` (a real secret). All Sentry vars are **optional**: leave them blank and the app runs with
Sentry off. Fill them in `.env` (see the Sentry block in `.env.example`). Split by when they're used:
- **Runtime (backend):** `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`.
- **Build-time (frontend, baked into the bundle):** `VITE_SENTRY_DSN`, `SENTRY_RELEASE`, and — for source-map
  upload — `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`. The token is passed to `docker build` as a
  **build arg** (Railway's builder rejects BuildKit secret mounts). It is recorded in `docker history`, so keep
  the image private and use a short-lived `project:releases`-scoped token. `SENTRY_AUTH_TOKEN` is
  **not** needed at runtime.

---

## Deploy

```bash
ssh ubuntu@<VM_PUBLIC_IP>
git clone https://github.com/avishek-giftnote/workout-logger.git
cd workout-logger
cp .env.example .env && chmod 600 .env
nano .env            # fill MONGODB_URI, SECURITY_JWT_SECRET, TUNNEL_TOKEN (+ optional Sentry block)
export SENTRY_RELEASE=$(git rev-parse --short HEAD)   # tag events + source maps to this deploy (optional)
docker compose up -d --build        # builds the image natively on ARM, starts app + cloudflared
docker compose ps                   # app should become 'healthy'; cloudflared 'running'
docker compose logs -f app          # watch startup (Mongo connect, Tomcat on 8080)
```
> `SENTRY_RELEASE` is read from the shell here so it isn't pinned in `.env`; set it (to the commit SHA) on each
> deploy so a new build's events + maps group correctly.

### Smoke-test
- `https://app.yourdomain.com/` loads the SPA; hard-refresh `/start` still loads (no 404).
- Register → log a workout → refresh → persists (proves Atlas + auth through the tunnel).
- `https://app.yourdomain.com/actuator/health` → `{"status":"UP"}`.

---

## Updating / CD
- **Manual update:** `git pull && docker compose up -d --build`.
- **CD (optional):** a GitHub Actions job (gated on the three CI gates + `push` to `main`) that SSHes into the
  VM and runs the pull+rebuild, e.g. via `appleboy/ssh-action` with the VM host/key in repo secrets. Or
  build+push an image to GHCR and have the VM `docker compose pull && up -d`. Restrict to backend/frontend path
  changes so docs-only merges don't redeploy.

## Ops ownership (new vs a PaaS — these are now yours)
- **SSH hardening:** key-only auth (`PasswordAuthentication no`), no root login, consider `fail2ban`.
- **Patching:** `sudo apt-get install -y unattended-upgrades` (or periodic `apt upgrade` + reboot).
- **Restart on reboot:** `restart: always` + Docker's systemd unit (enabled by default) bring the stack back
  after a VM reboot. Verify with a test reboot.
- **Backups:** Atlas M0 has limited/no automated backup — for real data, schedule `mongodump` (cron on the VM
  to OCI Object Storage, 20 GB free) or upgrade Atlas. Phase-1/single-user: acceptable risk.

## Known limitations (revisit before scaling)
- **Rate limiter + draft state are in-memory** — correct for this single VM; multiple instances would need a
  shared store (Redis).
- **Atlas M0** — shared, no SLA, 512 MB, max 500 connections. With 24 GB on the VM you *could* self-host Mongo
  instead (drops the M0 limits, adds backup/security burden) — not worth it for Phase 1.
- **Single VM = single point of failure** — fine for a personal app; no HA.
- **No observability** beyond `docker logs` — add structured (JSON) logging + a metrics endpoint before scaling.
- **No data-migration story** — a schema-shape change currently means re-import into a fresh DB; design a
  migration path before there's real user data to preserve.
- **Phase 2 (deferred):** Stripe + a `subscribed` flag + a `403` sync-gate + delta-sync over the existing REST
  API (the local-first `LocalStore` seam already exists client-side).

_Last updated: 2026-06-30 — OCI Always-Free + Cloudflare Tunnel (migrated off Fly.io)._
