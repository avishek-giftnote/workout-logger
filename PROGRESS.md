# Progress & agenda — Workout Logger

Living status file — the done / backlog tracker for this project. **Update it whenever work changes:**
finish a thing → move it to Done; pick up or think of a new thing → add it to the agenda; make a call
that isn't captured in the code → log it. Keep entries dated, newest near the top of each section.

_Last updated: 2026-06-23_

> Maintenance: a global Stop hook (`.claude/hooks/check-progress.sh`) blocks the end of a turn if any
> source/`.md` file in this folder is newer than this file — it nudges whenever the tracker falls
> behind. Self-clearing: updating (or `touch`-ing) `PROGRESS.md` makes it newest again. It can't see
> conversation-only decisions, so logging those is still on you.

## Pending decisions (needs Avishek)

- **Rotate the Atlas DB password + set a real JWT secret** — the `avishek_db_user` Atlas password was pasted
  in chat this session; the dev `SECURITY_JWT_SECRET` is a throwaway. Rotate before any real prod use.
- **Deferred coaching findings** (`docs/eval-findings.md`, evals pin current behavior under TODO):
  - Deload-floor magnitude for low-ceiling blocks (PEAK / STRENGTH-non-focus) — currently a deload can equal
    accumulation; should it step down relative to the block's own ceiling?
  - Dead-band anchor weight (regression-mean vs latest) in `EnergyService`.
- **Operational policy** (`DESIGN.md §8`): backup/PITR cadence; GDPR hard-delete vs tombstone retention
  (`rawImport` embeds PII); `startedAt`/bodyweight timezone policy; offline auth/token-refresh lifecycle.
- **Subscription model** — when/how to gate cloud sync (only the `SYNC_ENABLED` seam exists today; no billing).
- **One-ACTIVE-plan-per-user** — enforce with a Mongo partial-unique index, or leave code-enforced?

## Done

- _2026-06-24_ — **Fail-fast on an unresponsive backend** (sign-in no longer hangs ~30s when MongoDB is
  unreachable): frontend API client now caps every request at a 12s `AbortController` timeout → a clear
  "Server isn't responding"/"Network error" `ApiError` instead of an indefinite spinner; backend
  `MongoClientSettingsBuilderCustomizer` drops the driver's 30s server-selection + connect timeouts to 5s
  (tunable via `mongodb.server-selection-timeout-ms`/`connect-timeout-ms`). Guards: client timeout/network
  tests (`api/client.test.ts`) + `MongoConfigTest`. Frontend 74 unit, backend 66. (Surfaced when an Atlas IP
  allow-list block made login hang — the connectivity cause is operational, this hardens the failure mode.)
- _2026-06-23_ — **Planner remodel — muscle-group slots + frequency-by-design**: `generateSplit` now emits
  **user-selectable slots** (a placeholder per unit of volume, ≤2 exercises/muscle/day, pre-filled with a
  recommended lift the user can swap from a dropdown of catalog exercises that train the muscle — `daySlots`,
  `PlanPage`); and the microcycle is **designed** so every prime mover + focus muscle lands ≥2×/week (shortfall
  muscles added to the lightest days), replacing the old after-the-fact warning. Guards: `daySlots` unit tests +
  eval R33 (freq-by-design) / R34–R35 (slot integrity, distinct defaults) — 240/240 configs pass; new Playwright
  specs (`plan-slots`, `plan-slots-mocked`). Frontend unit 72 + 3 eval sweeps. Docs: `coach.md`, `DIAGRAMS.md` #14.
- _2026-06-23_ — **Docs synced to local-first settings**: `DIAGRAMS.md` #1/#2/#4/#12 updated (User.settings +
  SQLite/LocalStore + LWW sync) and `DIAGRAMS.pdf` regenerated (16/16); created this `PROGRESS.md`.
- _2026-06-23_ — **CI release gate** (`.github/workflows/ci.yml`): frontend-gate (typecheck/unit/eval/build),
  backend-gate (`RUN_MONGO_TESTS` mvn test), and **Playwright** critical-path E2E (`frontend/e2e/`) — register
  → log → persist → edit, settings persistence, login-error message. No secrets (mongo:7 service container).
- _2026-06-23_ — **Local-first settings storage**: `LocalStore` seam (SQLite-WASM/OPFS + localStorage fallback,
  `frontend/src/local/`), `settings.tsx` async hydrate + legacy migration + last-write-wins server sync
  (`GET/PUT /api/me/settings`, `User.settings`). Cloud sync is the future subscription feature.
- _2026-06-23_ — **Bug fixes**: bodyweight trend chart now date-ordered (`realWeightSeries`); login shows
  "Incorrect email or password." vs "Session expired" (+ first `api/client` tests).
- _2026-06-23_ — **Resolved the 5 deferred coaching decisions** (D1 confidence-gated phase clamp, D2 focus-muscle
  MEV floor, D3 maintenance slow-gain, D4 small-n t-multiplier, D5 keep-both e1RM) — each pinned by a guard.
- _2026-06-23_ — **Council-ratified eval suite** (logging `L##` / planner+prescription `R##` / energy `E##` /
  state-machine `SM##`) + 6 surfaced bugs fixed (bw float drift, volume escaping MRV, CONTEST_PREP calendar
  overshoot, `accumulationWeeks` domain clamp, `intensityBand` validation). ~62 backend + 66 frontend + 3 eval
  sweeps.
- _foundation (pre-2026-06, v5 as-implemented)_ — Strong CSV importer (deterministic, exact-count asserted);
  session-as-document Mongo model with tenant isolation + decimals-as-strings; coaching engine Layers 0–5
  (macrocycle planner, prescription engine, energy/bodyweight `EnergyService`); default-exercise seeding;
  React/Vite logging engine shared by new+edit; 16 validated Mermaid diagrams. See `DESIGN.md` / `docs/coach.md`.

## On the agenda (backlog, not started)

- **Cardio logging** — additive `distanceM`/`durationS` + CARDIO category (DESIGN.md-deferred; 0% in Strong data).
- **Offline-first for the full data model** — extend the `LocalStore` pattern from settings to
  workouts/exercises/templates/plans with the planned delta-sync (`updatedSince` + `deletedAt` tombstones +
  an outbox). The deferred mobile phase; large, warrants a council. Native shells swap in
  `expo-sqlite`/`better-sqlite3` behind the same interface.
- **Prod-readiness (beyond the CI gate)**: k6 load + data-volume probe (esp. the O(n) client-side
  full-workout-list scans in `pickPrevSets`/`topWorkingSet`/`weeklyMuscleSets`); observability
  (Sentry/health/uptime); secrets manager; Atlas backups/PITR; a `security-review` pass.
- **Subscription/entitlement layer** — gate cloud sync (flip `SYNC_ENABLED` per entitlement).
- **More UI testing tiers** — component (RTL) tests, visual regression, cross-browser E2E.
- **Tooling skills** (CLAUDE.md recommendations): `/restart-smoke`, `/diagrams`.

### Claude Code tooling gaps (learned but under-used)
- **Browser MCP** — wire Playwright MCP so UI verification is automated; "verify in the running app" is still manual.
- **Council as a Workflow** — wrap `/council` in a Workflow to cut convene friction (skipped on small changes today).
- **Eval regression scorer** — add an eval-sweep-style baseline diff; suites pass/fail but don't report *what* regressed.
- **Project skills** — bottle recurring rituals (`/diagrams`, `/restart-smoke`).
