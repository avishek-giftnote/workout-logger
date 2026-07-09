# Progress & agenda — Workout Logger

Living status file — the done / backlog tracker for this project. **Update it whenever work changes:**
finish a thing → move it to Done; pick up or think of a new thing → add it to the agenda; make a call
that isn't captured in the code → log it. Keep entries dated, newest near the top of each section.

_Last updated: 2026-07-07 (database-situation audit + current-model class diagram)_

> Maintenance: a global Stop hook (`.claude/hooks/check-progress.sh`) blocks the end of a turn if any
> source/`.md` file in this folder is newer than this file — it nudges whenever the tracker falls
> behind. Self-clearing: updating (or `touch`-ing) `PROGRESS.md` makes it newest again. It can't see
> conversation-only decisions, so logging those is still on you.

## Pending decisions (needs Avishek)

- **Database situation — audited + largely REMEDIATED 2026-07-07 (`docs/db-situation.md`).** Root cause was
  DB-lifecycle hygiene, not the schema (one Atlas cluster with 16 databases because test/smoke runs named an
  isolated `workoutlogger_*` DB per run and never dropped it — all synthetic). **Done:** (1) **test-DB teardown
  wired + verified** — backend `@AfterAll` (`TestDbCleanup`, guarded to only ever drop a `workoutlogger_*` DB,
  never the dev DB) on `ApiIntegrationTest` + `RateLimitIntegrationTest`, and a Playwright `globalTeardown`
  (remote-only; CI's ephemeral `mongo:7` is a no-op); both confirmed to drop the run's DB. (2) **13 stray test
  DBs dropped** — the cluster is now **3** (only `workoutlogger` dev + `admin`/`local`). (3) **Demo account
  recreated + test users purged 2026-07-07.** `import@giftnote.com` / **`workout123`** rebuilt into
  `workoutlogger`. The git-ignored `strong_workouts.csv` was unrecoverable (never committed — correct), but the
  importer's verified output survived in the git-ignored `tools/import_preview.json`; inverted it back to raw
  CSV rows and re-ran the **tested** importer (`--importer.persist=true`), so the exact-count assertion
  (1,533/47/30/195/61) proved the reconstruction faithful. **Re-imported at a 59 kg bodyweight baseline** (not
  75) so bodyweight-exercise loads are coherent with the person's real weight (Pull Up effective 59 / 69), since
  historical set weights are stored, not recomputed at read. Added **18 realistic weigh-ins** (mean-reverting
  58.5–59.3, ±0.5 around 59) across the last two months via the validated `PUT /api/me/bodyweight`, dropped the
  flat estimated baseline row. **Deleted all 8 `@example.com` test accounts** (`probe-*`/`runskill-*`/`e2e+*`)
  + their per-user data (50 workouts, 702 exercises, 4 templates) across every collection — the DB now holds a
  single clean user. Verified: login `workout123` → token, wrong pw → 401, `GET /api/workouts` → 47,
  decimals-as-strings on the wire, `entryId`/Decimal128 in Mongo. (4) **Diagrams consolidated + moved to
  `docs/`.** `DIAGRAMS.md` + `DIAGRAMS.pdf` moved from repo root → `docs/` (builder paths, `CLAUDE.md`,
  `DESIGN.md`, `.dockerignore`, `autopilot.md` updated). Diagram **#12 rewritten as the full domain class
  diagram shown as STORED** (Mongo storage types — `ObjectId`/`Decimal128`/`ISODate`/String refs — every field
  of all 6 collections + embedded types + all 14 enums; fixed the `BodyweightEntry.id`→`entryId` error and added
  the missing cardio/`version` fields). #2 ERD gained the `plans` (Macrocycle/Mesocycle) collection + a
  `BODYWEIGHT_ENTRY` block; #3 gained `PlanController`/`MeRepository`/`PlanRepository`. **PDF regenerated 17/17**
  and visually verified readable. The standalone `data-model.md` was folded into #12 and removed.
- **Deployment: scaffolded, NOT executed.** Docker + compose + Cloudflare-Tunnel + OCI runbook merged
  (PRs #24-26; `DEPLOY.md` is authoritative). Blocked on the VM-shape choice: **Path A** (add 4 GB swap +
  cap the JVM heap on the free 1 GB x86 micro, ship now) vs **Path B, recommended** (PAYG upgrade → Ampere
  A1 aarch64, roomier). Pre-deploy must-dos: rotate the Atlas password + a fresh `SECURITY_JWT_SECRET` (the
  one pasted in an old chat is burned), allowlist the VM's reserved IP in Atlas. _(handoff.md consolidated
  here + `DEPLOY.md` and removed 2026-07-07.)_
- **Rotate the Atlas DB password + set a real JWT secret** — the `avishek_db_user` Atlas password was pasted
  in chat this session; the dev `SECURITY_JWT_SECRET` is a throwaway. Rotate before any real prod use.
- **Deferred coaching findings** (`docs/eval-findings.md`, evals pin current behavior under TODO):
  - Deload-floor magnitude for low-ceiling blocks (PEAK / STRENGTH-non-focus) — currently a deload can equal
    accumulation; should it step down relative to the block's own ceiling?
  - Dead-band anchor weight (regression-mean vs latest) in `EnergyService`.
- **Operational policy** (`DESIGN.md §8`): backup/PITR cadence; GDPR hard-delete vs tombstone retention
  (`rawImport` embeds PII); `startedAt`/bodyweight timezone policy; offline auth/token-refresh lifecycle.
- **Subscription model** — when/how to gate cloud sync (only the `SYNC_ENABLED` seam exists today; no billing).
- **Cloud-sync architecture — council ran 2026-07-02, verdict recommend-only** (`docs/sync-architecture-council.md`):
  unanimous **BUILD** hand-rolled delta-sync on the existing Spring/Mongo REST API (delta-read endpoint +
  `If-Match`/409 + client outbox), **not** PowerSync/ElectricSQL (a full DB migration or a second service that
  duplicates tenant isolation for ~1 user). Conflict model = whole-doc LWW backstopped by `@Version`. Open calls
  for Avishek: (1) greenlight BUILD? (2) Phase-1 409 UX — rebase-retry-only vs "keep mine/keep server's" prompt;
  (3) tombstone-retention window (entangled with the GDPR hard-delete decision above). Dissent preserved in the
  brief: backend-eng sizes it 1.5-2wk (the `If-Match` retrofit across 8 endpoints, not delta-read, is the critical
  path); data-modeler flags the `@Version` backfill trap (annotating Exercise/Template/Split without a `version=0`
  backfill breaks Spring's insert-vs-update branch).
- **Phase-0 hardening — IMPLEMENTED via `/autopilot` (2026-07-02), gate green, review council in flight.**
  `WorkoutRepository.updateSet` now enforces the `@Version` precondition via an optional `If-Match` header
  (optional-when-present, additive), returns a 3-state `SetUpdateResult` → controller maps stale→**409** (with
  the server's current copy in `.detail`), missing/other-tenant/soft-deleted/set-missing→**404** (no existence
  leak). `WorkoutDto` gained a read-only nullable `version` (+ `types.ts` mirror, optional); malformed `If-Match`
  →400. A deciding council set the contract (unanimous: If-Match header, optional, expose version, re-query
  disambiguation, server-only scope — frontend send/rebase deferred to sync Phase-1). 11 new `ApiIntegrationTest`
  guards (RED→GREEN). The guards surfaced + fixed a **pre-existing** bug: a phantom version bump on a missing
  `setId` (update matched the doc regardless of the arrayFilter); now set-existence is part of the match. Gate:
  ApiIntegrationTest 56/56, backend pure BUILD SUCCESS, frontend tsc+124 vitest+build. **Review council PASSED**
  (backend-engineer + data-modeler CLEAN; eval-engineer/systems-architect findings triaged — two test-coverage
  gaps fixed in-loop: legacy-null-version *write* path + cross-tenant no-`detail`-leak assertion). **SHIPPED as
  PR #27** (squash-merged to `main` as `bd2100c`, 2026-07-02; CI green: frontend + backend/Mongo + Playwright e2e).
  First end-to-end run of the new `/autopilot` harness ([[autopilot-harness]]).
  - _Deferred to the version-audit (review council flagged, out of scope for Phase-0, logged not dropped):_
    (1) **409 body divergence** — the pre-existing `PUT /workouts` + Plan `save()` paths return 409 with
    `detail:null` via the generic `OptimisticLockingFailureException` handler, while the new PATCH returns the
    server's current copy. The PATCH shape is the target (matches the sync council); harmonize the generic
    handler to re-query + attach `.detail` during the audit. (2) **Template doesn't generalize** — `SetUpdateResult`
    /`updateFirst` fits embedded-array writes; Exercise/Template/Split/Plan use `mongo.save()` (managed `@Version`
    fires automatically) and must NOT copy this mechanism, and need the `version=0` backfill BEFORE `@Version` is
    annotated. (3) Bare-integer `If-Match` (not RFC-7232 quoted ETag) is a decided deviation — write it into
    DESIGN.md before 7 more endpoints copy it. (4) Promote the strongest set-update guards to a numbered `S##`
    catalog when the sync ship-gate is built.
- ~~**One-ACTIVE-plan-per-user** — enforce with a Mongo partial-unique index, or leave code-enforced?~~
  **Decided 2026-06-30: partial-unique index** (`plans {userId}|status=ACTIVE`), built at boot. See Done.

## Done

- _2026-07-07_ — **Cardio logging completed end-to-end via `/autopilot`.** Cardio was already substantially
  wired (domain, DTO round-trip, live logging engine, picker, 7 seeded exercises, per-exercise history); a
  council scoped the two real gaps + additions. **Shipped:** (1) **backend validation** — cardio DTO fields had
  ZERO Bean-Validation; added 3 patterns (`CARDIO_DISTANCE_PATTERN` allows meters to 999999.999 so a 10 km run
  "10000" passes — the ≤9999 strength `DECIMAL_PATTERN` would have rejected it), signed grade `@DecimalMin/Max(-30,40)`,
  elevation `@DecimalMax(20000)`, `durationS @Max(86400)`, `cadenceSpm @Max(300)`; `$jsonSchema` floors on
  distanceM/elevationGainM (fresh-collection backstop). (2) **frontend display** (the primary gap) —
  `WorkoutDetailPage` rendered a logged run as "— kg / — reps / —"; now shows the shared `formatSetLabel`
  ("5.20 km · 26:14 · 5:03 /km"), reps/rpe suppressed per-set, conditional stat tiles (kg-volume / distance /
  both); extracted `fmtTime`+`formatSetLabel`+`cardioSummary` into `engine.tsx` and deduped `ExerciseDetailPage`
  (the two divergent copies were how the gap arose). **Fixed a bonus bug:** `fmtTime` hour-rollover (a 90-min
  ride read "90:00"; now "1:30:00"). (3) **per-modality seed `cardioMetrics`** (new users). **Review council
  found 2 MAJORs, fixed in-loop:** the free-text grade/elev inputs could emit an off-pattern value (3-decimal
  grade → whole-workout 400 on a later edit) → `toCreateSet` now rounds grade/elev to the pattern precision like
  distance; and the seed `cardioMetrics` was untested → a backend guard now asserts Rowing Machine seeds with
  CADENCE (not the default fallback). **Deferred/accepted (documented):** `UpdateSetRequest` cardio fields +
  cardio `Equipment` value + existing-user backfill (council); the `$jsonSchema` floor only attaches to fresh
  collections (defense-in-depth; the DTO `@Pattern` is the real guard). Gate: backend 77 tests
  (incl. 10km-accepted + boundary/reject + negative-grade + edit-PUT round-trips + seed metrics), frontend tsc +
  139 vitest + eval + build, and a **live-verified cardio e2e** (`cardio.spec.ts`). **Not yet committed.**

- _2026-07-02_ — **M3 (User-doc lost updates) IMPLEMENTED via `/autopilot` — gate green, review council in
  flight.** Second autopilot run; picked as highest-priority open item (the audit's last non-LOW finding;
  the agenda's two "HIGH" planner bugs turned out already fixed in code — structural-diff reset notice +
  exact-remainder duration — agenda entries were stale). A deciding council (backend-eng, data-modeler,
  systems-architect, frontend-eng + Opus chair) ruled: **targeted atomic ops, NO `@Version` on User** (would
  409 disjoint writes; client swallows settings errors → silent loss; backfill trap for zero benefit). Built:
  new `MeRepository` (conditional-LWW settings `updateFirst`, `$push` with the 3650 cap in-match via
  `$expr $size`, positional-`$` amend / `$pull` delete keyed `bodyweightLog.entryId`, per-field profile `$set`
  + two-op set-once `initialIntakeAt`); `MeController` rewritten (zero `save()`, `current()` is a pure read);
  `BodyweightEntry.id`→`entryId` (embedded `id`→`_id` trap, wire name unchanged); `currentBodyweightKg`
  **derived at read** (`BodyweightMath`, with a deliberate derive-else-legacy-mirror fallback for import-era
  accounts — deviation from the council's "read-never", under review); `BodyweightEntryIdBackfillRunner`
  (startup, raw-Document, preserves legacy ids); **DESIGN.md §2a** (three-mechanism concurrency-selection
  rule) + CLAUDE.md pointer. 14 failing-guard-first `ApiIntegrationTest` cases (7 RED pre-fix → all green).
  Gate: ApiIntegrationTest **71/71** (isolated DB), EnergyServiceTest 19/19, backend pure BUILD SUCCESS,
  frontend tsc + 124 vitest (client untouched). **Review council found 3 MAJORs — all fixed in-loop:**
  (1) the backfill runner's blind full-array `$set` could clobber boot-window writes (Tomcat serves BEFORE
  `ApplicationReadyEvent`) → rewritten as a per-doc **compare-and-swap** on the array snapshot, bounded
  retry loop keyed on seen-not-fixed (a follow-up single-reviewer verify caught the seen/fixed conflation);
  (2) my derive-fallback deviation was WRONG — deleting the last real weigh-in resurrected the frozen import
  weight (energy-analyst reproduced it live) → every bodyweight write now `$unset`s the mirror in the same
  atomic update, exactly reproducing the old recomputeCurrent lifecycle (pinned:
  `legacyMirrorIsRetiredOnFirstWriteNeverResurrected`, incl. a non-binary-representable Decimal128
  round-trip); (3) the EnergyService n==0 mirror-fallback was test-uncovered → pinned in EnergyServiceTest.
  Accepted residuals documented in DESIGN.md §2a (two-op `initialIntakeAt` crash window — write-only field;
  backfill CAS race window structurally untestable in-suite, hand-verified by an adversarial reviewer).
  **SHIPPED as PR #29** (squash-merged to `main` as `a05b38b`, 2026-07-02; CI green incl. backend/Mongo).
  Second end-to-end `/autopilot` run. **M3 was the audit's last open non-LOW finding — the prod-audit
  cluster (C1/C2/H1–H4/M1–M7) is now fully closed.**

- _2026-06-30_ — **Deploy target → OCI Always-Free + Cloudflare Tunnel** (Fly's free tier was withdrawn).
  Replaced the Fly scaffolding with a VM-based stack: `docker-compose.yml` (`app` with **no published host
  ports** + `cloudflared`), `.env.example` (secrets template; real `.env` git-ignored via a `!.env.example`
  negation), a Docker `HEALTHCHECK` on `/actuator/health`, and the `curl` it needs; removed `fly.toml`.
  Topology: Browser → Cloudflare edge → tunnel → `cloudflared` → `app:8080` → Atlas — so **no inbound ports**
  (sidesteps OCI's double-layer firewall) and TLS/IP-hiding come free from Cloudflare. The `Dockerfile`
  (pure-JVM, multi-arch bases) runs on **ARM64/Ampere unchanged**; M7's `SPRING_PROFILES_ACTIVE=prod` moves to
  compose. `DEPLOY.md` fully rewritten as the OCI runbook (provision Ampere A1 → install Docker → Cloudflare
  tunnel → Atlas allowlist the VM's *reserved* IP → `compose up`). Considerations captured: Ampere capacity
  scarcity, in-memory rate-limiter/draft (single-VM only), new ops ownership (SSH hardening, patching, backups).
  _Manual steps remaining (you): provision the VM, Cloudflare domain+tunnel token, Atlas IP allowlist, fill
  `.env`, `docker compose up -d --build`._ (Compose not tool-validated locally — no Docker in this env.)
- _2026-06-30_ — **Deployability: SPA-serving + health + Docker scaffolding + M7 JWT fail-fast** — PRs #23
  (backend-serving + M7) & #24 (infra), two parallel worktree lanes (one stopped mid-run and finished by hand +
  folded in M7). Makes the app shippable as a **single jar** (backend serves the bundled SPA, same origin → no
  CORS — client already calls relative `/api`): `SpaForwardController` forwards extensionless client routes to
  `index.html` (deep links/refresh don't 404); `SecurityConfig` → `/api/**` authenticated, rest public;
  `spring-boot-starter-actuator` exposes only `/actuator/health` for Fly. `Dockerfile` (3-stage, proven the SPA
  lands in the jar via `unzip -l`), `.dockerignore`, `fly.toml` (force_https, health check, scale-to-zero,
  512MB, `[env] SPRING_PROFILES_ACTIVE=prod`). **M7:** blank `SECURITY_JWT_SECRET` now fail-fasts under the
  `prod` profile (dev/tests/e2e keep the ephemeral fallback → CI unaffected). Guards: `ApiIntegrationTest` **44**
  (health public / API still 401 / SPA routes forward) + `JwtServiceTest` **6** (+3 M7); gate green, e2e green.
  Deploy runbook + manual-steps checklist in **`DEPLOY.md`**. _Manual steps remaining (you): Fly account+login,
  Atlas IP allowlist (0.0.0.0/0), rotate the exposed Atlas password, `fly secrets set MONGODB_URI/SECURITY_JWT_SECRET`,
  `fly deploy`._
- _2026-06-30_ — **Fixed audit H2 + M1 + M2 + M4 + M5 (backend hardening cluster)** — PR #21, one sequential
  pass (these share `ApiIntegrationTest`/`ApiDtos`/`ApiExceptionHandler` → not lane-parallelizable). **H2:**
  `@Version` on `Macrocycle` + `OptimisticLockingFailureException → 409` — concurrent `advance()` no longer
  silently drops writes (losers 409, not a 200 that did nothing). **M1:** bodyweight-precision 400 fixed — client
  rounds effective load to 1e-3 (`engine.tsx`, was 1e-6) + `@Pattern` on `SetBodyweightRequest.weightKg`. **M2:**
  malformed JSON / bad dates now 400 not 500 (`HttpMessageNotReadableException → 400` + the three bare
  `LocalDate.parse` wrapped). **M4:** `@Size(max=50)` exercises / `@Size(max=100)` sets + bodyweight-log cap 3650.
  **M5:** split `weekdays` constrained `List<@Min(0)@Max(6)Integer>`. Failing-test-first (H2 + malformed-JSON
  confirmed failing pre-fix); +6 guards → `ApiIntegrationTest` **43**, gate `RUN_MONGO_TESTS=1 mvn test` 83/0/0,
  no-DB green, frontend 124 + eval (L1 drift 0, 240/240) + build green. **M3 deliberately deferred** — full
  `User` `@Version` would 409 the local-first settings sync (LWW); proper fix is targeted atomic `$set`/`$push`,
  its own PR. _Audit now: only M3 + the LOW tail (L1–L9) remain open._
- _2026-06-30_ — **Fixed audit C2 (rate limiting)** — PR #19, **parallel worktree Lane B** (ran concurrently
  with Lane A; backend-only vs frontend-only → zero-conflict merge). Per-IP rate limiter on `/api/auth/**`
  (`RateLimitFilter`, a `OncePerRequestFilter` at `HIGHEST_PRECEDENCE` so it sheds load before the security
  chain / BCrypt): fixed-window counter in a `ConcurrentHashMap`, keyed by `X-Forwarded-For` first hop else
  `getRemoteAddr()`, → **429** with the standard `{timestamp,status,error,message}` envelope. No new dependency;
  in-memory / single-instance-correct (multi-instance needs Redis — noted in code). Configurable via
  `@ConfigurationProperties("security.ratelimit")`: `enabled`(true)/`capacity`(10)/`window-seconds`(60).
  Suite interaction handled: the limiter is disabled in `ApiIntegrationTest` (its 12-concurrent same-IP register
  burst would trip it) via the class's `@TestPropertySource`; a dedicated `RateLimitIntegrationTest` (capacity=3)
  proves the 429 (failing-before/passing-after). Gate: `RUN_MONGO_TESTS=1 mvn test` **77/0/0**, no-DB green.
  _Follow-up:_ rate-limit response should also send `Retry-After`; multi-instance store when scaled.
- _2026-06-30_ — **Fixed audit H3 + H4 (frontend session resilience)** — PR #18, **parallel worktree Lane A**
  (ran concurrently with the C2 rate-limit lane; disjoint files → clean merge). **H3:** a mid-session 401 now
  drops the app to the login screen — `auth.tsx` exposes a module-level `onUnauthenticated` callback (wired by
  `AuthProvider` to clear token + `setToken(null)`) that `client.ts` invokes on a non-auth 401, instead of only
  clearing localStorage while `isAuthed` stayed true. **H4:** plan `accept` no longer fails silently —
  `onMutate`/`onError` surface the message; orphaned-template path took the **dedupe-defer** route (no
  `DELETE /api/templates/{id}` endpoint exists, so the create loop skips a same-name template via the new pure
  `findExistingTemplateId`; true rollback deferred to a future delete endpoint, noted in code). Gate: typecheck ·
  `npm test` **124** (+8) · build. **Open audit items remaining after C1/H1/H3/H4/C2:** H2 (`advance()` lost
  update — `@Version`), M1 (bodyweight-precision 400), M2 (malformed-JSON/date 500→400), M3 (`User` `@Version`),
  M4/M5 (`@Size` caps, weekday bounds), plus the LOW tail (these cluster in `ApiIntegrationTest`/`ApiDtos`/
  `ApiExceptionHandler` → best as one sequential backend-hardening pass, not parallel lanes).
- _2026-06-30_ — **Fixed audit C1 + H1 (the two race-condition CRITICAL/HIGH)** — DB-level backstops, failing
  test first. `MongoSchemaInitializer.initialize()` now runs on **every web boot** via new
  `config/SchemaBootstrap` (`@ConditionalOnWebApplication`, `ApplicationReadyEvent`) — previously it ran only in
  the one-time `import` profile, so a normal server had **no unique `users.email` index** (→ the registration
  TOCTOU created duplicate accounts → login 500). Added a **partial-unique `plans {userId}` index filtered on
  `status:"ACTIVE"`** (one ACTIVE macrocycle per user) + the `splits`/`plans` collections to the initializer, and
  an `@ExceptionHandler(DuplicateKeyException) → 409` so race losers fail cleanly instead of 500. Guarded by two
  new `ApiIntegrationTest` concurrency tests (`concurrentRegisterOfSameEmailCreatesExactlyOneAccount`,
  `concurrentCreatePlanLeavesExactlyOneActivePlan`) — **confirmed failing first** (12 concurrent registers → many
  accounts; 10 concurrent createPlan → >1 ACTIVE), green after. Gates: `RUN_MONGO_TESTS=1 mvn test` **37/0/0**
  (fresh DB, validators on), no-DB `mvn test` **76/0** (37 skipped). Live re-verified: 20 concurrent registers →
  **1 account + login 200**; 15 concurrent createPlan → **1 ACTIVE plan** (DB-confirmed). Fail-fast caveat: the
  boot-time unique-index build throws if the live DB already holds duplicate emails — dedupe before deploying.
  **Still open from the audit:** C2 (rate limiting) + the HIGH/MEDIUM UX/validation items.
- _2026-06-30_ — **UI/UX + prod-readiness council audit** (`docs/uiux-prod-audit.md`). 5-lens code council
  (contract-drift, backend-validation, concurrency, security, UX) **cross-checked by a live multi-user
  concurrency simulation** against a running backend on an isolated `workoutlogger_conctest` Atlas DB.
  **Verified-live findings:** (C1) registration TOCTOU → 23 duplicate accounts for one email (DB-confirmed) →
  login for that email **permanently 500s** (`findByEmail` IncorrectResultSize); root cause: unique `users.email`
  index only built in the `import` profile (`auto-index-creation:false`). (C2) **no rate limiting** — 30
  concurrent wrong-pw logins all 401 instant, zero 429. (H1) **two ACTIVE plans** from 15 concurrent createPlan
  (DB-confirmed: 2). (H2) `advance()` **lost update** — 10 concurrent advances → week 2 vs 11 sequential
  (`Macrocycle` has no `@Version`). (M1) bodyweight **precision drift 400** blocks the logging loop (client 1e-6
  vs backend `@Pattern` 1e-3). (M2) malformed JSON → 500 not 400. **Held up:** tenant isolation (B→A workout 404,
  list empty), auth enforcement (forged/garbage/no token all 401), decimals-as-strings on the wire, all 33
  `Api.*` endpoints + enums + nullable-field guards. Full ranked list (2 CRITICAL, 5 HIGH, 8 MEDIUM, 9 LOW) +
  fixes in the doc. Backstops the two pending decisions below (one-ACTIVE-plan index, JWT secret) with evidence.
- _2026-06-25_ — **Docs synced to this session's design changes** (4 parallel sub-agents, each verified vs code).
  `DESIGN.md` (terminal plan states + `splitId`/`completedAt`/`endedAt`, `Split.weekdays`, `CreateSetRequest`
  validation invariant, `GET /plan/history`, the completion/WeekCalendar/reliability/onboarding frontend layers),
  `docs/coach.md` (rest-day `scheduleWeek`, distinct-stimulus slots + intra-session ordering, `SESSION_TOTAL_CAP`,
  duration-truncation, cross-block e1RM anchor, the R36–R40 + prescription R37 catalog), `DIAGRAMS.md` (class #12 +
  build-plan #14 + log-session #13 updated, new completion+history #17; now 17 diagrams) → `DIAGRAMS.pdf`
  regenerated (17/17 render, validates the Mermaid), `CLAUDE.md` (suite sizes 116 unit / 35 integration / 6 e2e,
  invariants, frontend structure). Cross-checked for consistency; stale counts cleared.
- _2026-06-25_ — **Council UX leftovers** (2 parallel sub-agents). (1) **Strength-block advisory** (`PlanPage`):
  during a STRENGTH/PEAK block the active view now shows a card noting the split still uses hypertrophy-picked
  exercises and to swap in heavy compounds. (2) **One-handed weekly calendar** (`WeekCalendar`): replaced the
  dropdown list with tap-a-training-day → tap-a-rest-day to move sessions (picked-cell outline + drop-target cues,
  tap-again to cancel); read-only mode + the 7-cell/rest e2e contract preserved. Gate: tsc · 116 unit · eval
  240/240 · build · e2e 6/6. Verified live: picked Mon/Upper A → tapped Tue → moved; strength-phase caption renders.
  (A 3rd agent's set-cap trim refinement was reverted — merged distinct pairs away; see agenda.)
- _2026-06-25_ — **Council follow-ups, batch 2** (4 parallel sub-agents on disjoint files). (1) **Session-level set
  cap** R40 — `SESSION_TOTAL_CAP=20`; over-cap days redistribute excess to a day already training the muscle, else
  trim (Upper B: ~29→20 sets live). (2) **Duration granularity** — replaced the `+2` slop with final-block
  truncation so distinct durations give distinct plans (3mo≠4mo). (3) **Cross-block load bump** R37 — at a
  rep-range/block change the seed anchors to e1RM (`workingLoad(e1rm,…)`) instead of firing unearned double
  progression. (4) **PlanPage UX** — "Strength phase" rename + per-block plain-English captions, timeline text
  9px→13px + horizontal scroll, two-step confirm on "Complete week →". (5) **Onboarding** — CoachCard GATHERING
  state gets a "Log weight" CTA + Mifflin estimate; a dismissible setup card on the home page for new users. Gate:
  tsc · 116 unit · eval 240/240 (incl. R37+R40) · build · e2e 6/6. Verified live: strength caption renders, Upper B
  capped at 20.
- _2026-06-25_ — **Fixed silent reset of plan customizations** (council HIGH, `PlanPage.tsx`). The picks + weekday
  reseed effects were keyed on `[preview]`, so ANY recompute (a background `exercises` refetch, or the async
  energy phase resolving) wiped the user's edits even when the slot layout was identical — and they could accept a
  reverted plan. Now keyed on a pure `planStructureKey(preview)` fingerprint (day names + per-slot muscles, ignoring
  default exercise ids), so edits survive non-structural recomputes; when a genuine structural change (goal/days/
  volume) does discard edits, an inline "Selections reset" notice fires. Guard: `planStructureKey` unit tests
  (same layout → same key incl. different defaults; changed muscle/count/day-name → different). tsc · 115 unit (+2)
  · eval 240/240 · build · plan-slots e2e. **Verified live**: customized a chest pick + a weekday, changed duration
  6→9mo (non-structural recompute), both survived (before: reset to defaults).
- _2026-06-25_ — **Reliability hardening — the council's 3 HIGH hazards** (`docs/planner-council-simulation.{md,pdf}`).
  Built by 3 synchronous sub-agents on disjoint files. (1) **Input validation** — mirrored `UpdateSetRequest`
  bounds onto `CreateSetRequest` (reps `@Min/@Max`, rpe, a weight `@Pattern`) + cascade `@Valid` so the bulk save
  path actually validates; `ApiIntegrationTest` asserts bogus reps/rpe → 400 (35/35). (2) **Error/offline states**
  — new `ErrorBoundary` (wraps the shell) + shared `QueryError` (Retry); 10 query-gated pages now render `isError`
  instead of spinning or seeding from `?? []`. (3) **Durable in-gym logging** — the live workout draft persists to
  the `LocalStore` seam (debounced) with a Resume/Discard prompt on reload + a `beforeunload` guard; plus a
  non-blocking large-jump weight warning. Gate green: tsc · 113 unit (+13) · eval 240/240 · build · backend 35/35
  · **e2e 6/6**. Verified live: started a session → reload fired the beforeunload guard → restore prompt rendered.
- _2026-06-25_ — **Council planner-simulation** (`docs/planner-council-simulation.{md,pdf}`, 8-page PDF) — 44-agent
  workflow role-played "Sam" through the full lifecycle (User → Coach → Exercise Scientist conversing per stage,
  findings fact-checked vs code). Verdict: engine sound, UI under-explains it. Top findings → the agenda below;
  the 3 HIGH reliability hazards are now done (above).
- _2026-06-25_ — **Planner Stages B+C — editable & persisted weekly calendar.** Backend (additive/nullable):
  `Split.weekdays` (0=Mon…6=Sun, aligned to templateIds) + `Macrocycle.splitId`; DTOs/mapper/repos/controllers
  wired; `ApiIntegrationTest` round-trips weekdays + splitId, null-safe + tenant-scoped (34/34). Frontend: new
  `<WeekCalendar>` (reuses `.cal-grid`); the builder shows it **editable** (reassign a session's weekday, swap on
  collision) with **live recovery-note recompute** (`scheduleNotes`), and warnings reclassified into advisory
  **Recovery** vs actionable **Catalog gaps**; `accept()` persists `weekdays` on the split + `splitId` on the plan;
  the active-plan view loads its split by `splitId` and renders the calendar read-only. e2e (`plan-slots-mocked`)
  extended to assert the 7-cell strip + rest days + the weekdays/splitId accept payload. Gate green: tsc · 100 unit
  · eval 240/240 · build · e2e · backend 34/34. **Verified live** end-to-end: built a 4-day plan (Mon/Wed/Fri/Sat
  + 3 rest), moved Upper B onto Tue → Recovery notes appeared instantly, moved back → cleared, accepted →
  active view shows the persisted schedule. Fulfills the "editable & persisted" choice.
- _2026-06-25_ — **Planner Stage A — rest-day scheduling + distinct-stimulus slots + intra-session order** (frontend,
  via `/pursue`; design in `.claude/plans/snappy-forging-scroll.md`). `periodization.ts`: new `scheduleWeek` places
  training days among 7 weekday slots with **rest days** (exhaustive, circular-adjacency-min) so a muscle on ≤3 days
  gets ≥48h — *this is what actually killed the "Side delts back-to-back" warning* (proven unavoidable by reordering
  alone). `daySlots` now consolidates to **one exercise/muscle/day** unless a 2nd is a strong primary of a different
  mechanic (chest bench+fly stays; side-delts machine+dumbbell → 4 sets of one), and **interleaves** slots so no two
  consecutive train the same primary muscle. `PlanPreview.schedule` (weekday per template) computed but not yet shown.
  Guards **R37** (scheduleWeek optimal + 4-day split has no recovery warning), **R38** (2 exercises/muscle only as a
  distinct-mechanic pair), **R39** (no same-primary back-to-back). Gate green: tsc · 100 unit · eval 240/240 + R36–R39
  · build. **Verified live** in the builder: warning gone, side delts 1×(4×8), chest keeps the pair, order interleaved.
  **Remaining (user chose editable & persisted):** Stage B backend `Split.weekdays`+`Macrocycle.splitId`, Stage C the
  editable WeekCalendar UI + active-plan display.
- _2026-06-25_ — **Plan completion UX — shipped & verified live.** Root cause was that `PlanRepository.baseQuery()`
  filtered `status="ACTIVE"`, so a `COMPLETED` plan vanished from `GET /plan` → 204 → builder, making `PlanPage`'s
  `done` branch dead code. Built via a parallel agent team (backend track ∥ pure-summary track on Sonnet, then UI
  track, then live verify on Opus).
  - **Backend:** split terminal state `COMPLETED` (ran to end) vs `ENDED` (ended early / replaced); added nullable
    `completedAt`/`endedAt`; `advance()` stamps `completedAt`, `endActive()` → `ENDED`+`endedAt`, `create()`'s
    replace-path → `ENDED` (was falsely `COMPLETED`); new `GET /plan/history` (terminal plans, newest-first,
    tenant-scoped). 3 new `ApiIntegrationTest` cases (history-with-timestamp, ended-early, **tenant isolation**) —
    30/30 pass against the isolated Atlas `workoutlogger_test` db.
  - **Frontend:** pure `summarizePlan()` + 22 tests; `<CompletionScreen>` (celebration + stats + top-5 e1RM gains +
    bodyweight delta, graceful zero/null states); `<PastPlans>` route + shared `<PlanSummaryCard>`; `PlanPage`
    no-active-plan branch now shows the completion screen (once, gated by local `dismissedCompletionPlanId`) else the
    builder; deleted the dead `done` branch; "Finish plan →" on the final microcycle; inline two-step End-plan confirm
    (no `window.confirm`); "Plan again, same settings" prefill. tsc + 96 tests + build green.
  - **Verified live** (Playwright MCP, tester account's real completed 24-wk plan, `completedAt:null`): completion
    screen renders with clean title, 5-block timeline, "24 sessions · 442 hard sets · 5 deloads", a strength gain, and
    the bodyweight line correctly omitted (weigh-ins predate the window); `/past-plans` lists + expands the shared card.
    Polish fix found & applied: suppress the redundant goal label when the plan name already contains it.
  - **Verified live (Playwright, throwaway 1-meso plan):** the active-plan "Finish plan →" label (final microcycle)
    vs "Complete week →" (non-final), and the inline two-step End-plan confirm (Confirm/Cancel, no `window.confirm`);
    Confirm persisted `ENDED`+`endedAt` and fell through to the builder (not the celebration). All 5 checks green.
- _2026-06-25_ — **Added `/pursue` command** (`.claude/commands/pursue.md`) — autonomous build-to-green loop: encodes a
  goal as objective checks (failing-guard-first), then loops implement→gate→verify until green or a 6-iteration cap,
  with honest-exit guardrails (never fake/weaken a check). Composes with the built-in `/loop` for self-pacing.
  Demoed live on the active-plan UI verification above (converged iteration 1, no fixes needed).
- _2026-06-25_ — **`src/planSummary.ts` + `src/planSummary.test.ts`** — pure `summarizePlan()` function and 22-test Vitest suite for the plan-completion summary screen. Computes weeks, blocks, sessions, hardSets, deloads, top-5 strength gains (e1RM first vs last non-deload session per exercise), bodyweight delta, and endedAt fallback. tsc + npm test green (96 tests total).

- _2026-06-25_ — **Fixed mongodb MCP "fails to connect"** — root cause was env propagation, not a bad URI:
  `MONGODB_URI` was empty in claude's launch environment (no `direnv hook zsh` in `~/.zshrc`, `.envrc` never
  `direnv allow`ed), so `${MONGODB_URI}` in `.mcp.json` interpolated to nothing. Made the mongodb server
  **self-sufficient**: its command now sources `backend/.env.local` itself (`bash -c '… . ./backend/.env.local;
  export MDB_MCP_CONNECTION_STRING="$MONGODB_URI"; exec npx …'`), so it connects from any launch context
  (direnv / fresh terminal / cron) with the secret still out of the committed file. Also finished the direnv
  setup (added the zsh hook + `direnv allow`; `direnv export` confirms `MONGODB_URI` loads on `cd`) for the
  dev-server workflow. **Manual step left: `/mcp` → approve `mongodb`** (editing `.mcp.json` resets approval).
- _2026-06-25_ — **HANDOFF.md completed** — brought fully up to date with the 24-week simulation run: tester account credentials (`tester@workoutlogger.com` / `TesterPass123!`), seeded data (23 sessions + 18 bodyweight entries), plan structure, all verified invariants (RIR wave, 5 deloads, 5 meso transitions, prescription engine, energy service clamping, plan completion), strength gains, and `docs/simulation_diagram.pdf` noted as intentional. TL;DR and To Resume sections corrected (servers were UP at session end, not down). PR #7 skill-disable attributed correctly to this session.
- _2026-06-25_ — **24-week Build-Muscle simulation** — registered `tester@workoutlogger.com` via UI, seeded 2 months of workout history + 18 bodyweight entries (energy service → READY/SURPLUS/HIGH), built a 6-month Build Muscle plan via the planner, simulated all 24 weeks via API, advanced through 5 mesocycles and 5 deload weeks to `status=COMPLETED`. All coaching invariants verified (see HANDOFF.md for full results). `docs/simulation_diagram.pdf` generated and committed.
- _2026-06-25_ — **Disabled project-irrelevant skills** (`daily-log`, `vault-knowledge`, `zest-scrape`, `new-project-bootstrap`) via `permissions.deny` in `.claude/settings.json`. Merged as PR #7. Effective for all Claude sessions in this project dir.
- _2026-06-25_ — **Log unhandled 500s** (`ApiExceptionHandler`): the catch-all `@ExceptionHandler(Exception.class)`
  returned `"Internal error"` but logged nothing, so every unexpected 500 was opaque. Added `log.error(...)`,
  which immediately surfaced a `MongoSecurityException` (Atlas SCRAM auth rejecting a stale DB password) behind
  a "stuck" backend. Also **verified the muscle-group-slot planner live via the Playwright MCP** against the
  running app: 4-day split, 41 slot dropdowns, every prime mover ≥2×/week incl. Side delts on 2 days.
- _2026-06-24_ — **MCP dev-loop setup (browser + Atlas)** — project `.mcp.json` wires two servers:
  **Playwright** (`@playwright/mcp`, headless/isolated, origins locked to the dev stack) for in-loop UI
  verification against the *running* app, and **MongoDB** (`mongodb-mcp-server`, read-only) for live DB
  inspection + optional Atlas access-list/cluster admin. Docs in `docs/mcp/`. Creds are env-only (`${MONGODB_URI}`
  + optional Atlas API keys in a git-ignored `.env.local`). **Pending one-time activation** (reload Claude Code +
  set env) before the tools go live — see [[browser-mcp]] / [[atlas-mcp]].
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

- **DB lifecycle hygiene (fix the stray-database leak) — scoped 2026-07-07 (`docs/db-situation.md`).** Once the
  pending-decisions above are answered: (1) make integration/e2e suites **drop their database on teardown** so
  Atlas runs stop leaking `workoutlogger_*` DBs (CI's `mongo:7` already disposes; only manual/Atlas runs leak);
  (2) a scripted **idempotent demo-seed** so the canonical account is rebuildable on demand (importer is already a
  pure deterministic transform); (3) one-time **cleanup** of the 13 leaked test DBs (destructive → needs approval).
  Not a schema change — the document model is sound.

- **E2E functionality suite (FE+BE Playwright, flag actual-vs-intended) — SHIPPED via `/autopilot` as PR #30 (`7a1b651`, 2026-07-02).**
  CI caught a flake my local Atlas runs couldn't: the e2e job red-then-green twice → **root cause was the per-IP
  auth rate limiter (audit C2) 429-ing the burst of registrations from CI's single host**, so the authed shell
  never rendered (a LATENT flake in the pre-existing e2e setup — also hit the old `plan-slots` spec). Fixed with
  `SECURITY_RATELIMIT_ENABLED=false` in the managed webServer env (as `ApiIntegrationTest` already does) +
  a longer `register()` auth-gate wait. All CI green on both workflow runs after the fix.
  - **F01 FIXED via `/autopilot` (2026-07-07):** `getWorkout` now coerces a 404 → null (mirrors
    `lastWorkingSet`/`getPlan`), so a missing/other-tenant workout deep-link shows "Workout not found" instead
    of the generic "Couldn't load data" — the detail page's previously-dead not-found branch renders.
    `EditWorkoutPage` gained the same branch (a coerced-null 404 would otherwise leave `blocks` null and spin
    forever — caught before shipping). Council skipped (mechanical fix, precedented pattern); frontend-engineer
    review CLEAN. Guards: the F01 `test.fixme` promoted to 2 live e2e tests (detail + edit routes) + the
    cross-tenant assertion flipped to "Workout not found". Gate: tsc + 124 vitest + build; e2e F01 guards green.
  Third autopilot run. A deciding council set the strategy (7 ranked specs, real jar + isolated Atlas,
  `test.fixme`+`docs/e2e-findings.md` found-bug convention). An eval-engineer review council then hardened it
  (caught a false-green substring count, a permissive assertion that blessed F01, a missing primary-entity
  decimal test, and confirmed the ADDED-mode failure was a spec bug). **Delivered:** 7 new spec files
  (`tenant-isolation`, `bodyweight-decimal` ×3 incl. the workout-set Decimal128 round-trip, `exercise-catalog`,
  `plan-lifecycle` ENDED walk, `coach-gate` gate, `workout-delete`, `empty-and-error-states`) + shared
  `logSet`/`logBodyweight` helpers + `docs/e2e-findings.md`. **Full suite: 14 passed / 3 fixme / 0 failed**
  (retries:1 now, to absorb remote-Atlas latency). No regression to the pre-existing specs.
  - **F01 filed** (`docs/e2e-findings.md`, MINOR): a cross-tenant/nonexistent workout deep-link renders the
    generic `QueryError` ("Couldn't load data") instead of a not-found state — `getWorkout` doesn't coerce a
    404, so `WorkoutDetailPage`'s "Workout not found" branch is dead code. Security intact. Tracked by a
    fails-loud `test.fixme` in `tenant-isolation.spec.ts`. **A cheap standalone fix candidate** (coerce 404→null
    in `getWorkout`, or reorder the not-found branch before the error branch).
  - **3 `test.fixme` gaps** (honestly scoped, no app bug masked): coach READY flip + plan COMPLETED walk (both
    need heavy fixtures/selector confirmation), and the ADDED-mode was FIXED (was a spec cell-indexing bug).
  - **Known limitation:** the `logSet`/`/start` specs flake against remote Atlas (~600ms/op RTT, no backend
    defect); reliable on local mongo / CI `mongo:7`. `retries:1` absorbs it. Council brief: workflow `wnrkfrd5o`.

- **Set-cap trim refinement (no thin slots) — deferred, needs care.** First attempt (drop/redistribute WHOLE slots
  instead of shaving to 1-set stubs) eliminated stubs but **merged distinct-stimulus pairs away**: relocating an
  over-cap day's isolation slot summed its sets into a *different-mechanic* slot on another day (e.g. chest fly →
  chest bench), collapsing the compound+isolation pair (caught by the `plan-slots-mocked` e2e; reverted). The right
  fix RELOCATES the whole exercise-slot as a *distinct* slot on a less-loaded day that trains the muscle (preserving
  the pair + variety), and only merges when the target slot is the SAME exercise/mechanic — respecting
  MAX_SLOTS_PER_MUSCLE + R38. Current behavior = the batch-2 cap (caps at 20 by shaving, leaves thin stubs). Low
  priority; the HIGH junk-volume issue is already resolved by the cap.

- **Council planner-simulation findings** (`docs/planner-council-simulation.{md,pdf}`, 2026-06-25). 44-agent council
  role-played "Sam" through the full lifecycle; verdict: *the coaching engine is sound, the UI doesn't explain it*.
  Actionable items, by priority:
  - **Reliability hazards (HIGH):** (1) no `isError`/offline state on any query-gated page — a dropped GET mid-gym
    spins forever or seeds from empty `?? []`; add error branches + an error boundary. (2) in-progress workout is
    pure React state — refresh/lock/nav-tap wipes the session; persist the live draft to the existing `LocalStore`
    seam + `beforeunload`. (3) `CreateSetRequest` has **no** validation (only `UpdateSetRequest` does) — a typo'd
    weight poisons e1RM/progression; mirror the bounds + a client "large jump" warning.
  - **Planner (HIGH/MED):** session-level total-set cap (Upper B prescribes ~29 sets — junk volume; `PER_SESSION_CAP`
    is per-muscle only); silent reset of weekday/slot picks on any macro-param change (`PlanPage.tsx:260–268`) — diff
    structurally; cross-block load bump at hypertrophy→strength (anchor to e1RM on block-type change); strength block
    in a build-muscle plan needs a "why" caption; 3- and 4-month both yield 14 weeks (`periodization.ts:505`).
  - **Quick wins (surfacing):** onboarding card + "Log weight" CTA on GATHERING_DATA; render the Mifflin estimate
    during gathering; legible block-timeline text (9px→≥13px); two-step confirm on "Complete week"; duration-mismatch
    notice. Full prioritized table + per-finding detail in the doc.

- **Edit-time recovery notes use slot primary muscles only** — `scheduleNotes` (the live warning when you drag a
  session in the builder) reads muscles off rendered slots, so it's slightly less sensitive than the synergist-aware
  auto-scheduler (`scheduleWeek`/`effOf`). Fine for live feedback; if exact parity is wanted, feed synergist info to
  `scheduleNotes` (e.g. pass the catalog or precompute per-template effective muscles). Small, low priority.

- **Non-dismissible recovery-adjacency warning** — "Side delts lands on back-to-back days" on every builder load.
  _Root-cause day-ordering attempted 2026-06-25 (via `/pursue`); proven a dead end for this case._ Made
  `orderForRecovery` **provably adjacency-optimal** (exhaustive over ≤6 days, replacing the greedy nearest-neighbour
  that's optimal-blind to its fixed start) + pinned with eval **R36** (failing-guard-first: greedy left 1 conflict
  where 0 was achievable; now matches the global optimum across an adversarial + 40-case random battery). Gate green
  (tsc · 96 unit · eval 240/240 + R36 · build). **But the Side-delts warning is mathematically unavoidable:** side
  delts is effectively trained on **3 of 4 days** (Upper A + Lower A explicit, Upper B via press synergy), and 3
  training days can't be mutually non-adjacent in a 4-slot week → ≥1 back-to-back is forced. The optimal order hits
  that minimum (1), so reordering can't remove it; the default 4-day split was already optimally ordered (no visible
  change there — R36's value is the correctness proof + regression guard + fixing suboptimal *other* configs).
  **Still open — to actually kill the noise needs a different lever:** (A) reclassify "Catalog gaps" → split
  actionable gaps from advisory **recovery notes** + make the latter dismissible (persisted); or (B) reduce side-delt
  effective frequency (training-design change). Awaiting the call.
- **Cardio logging** — additive `distanceM`/`durationS` + CARDIO category (DESIGN.md-deferred; 0% in Strong data).
- **Offline-first for the full data model** — extend the `LocalStore` pattern from settings to
  workouts/exercises/templates/plans with the planned delta-sync (`updatedSince` + `deletedAt` tombstones +
  an outbox). The deferred mobile phase; large, warrants a council. Native shells swap in
  `expo-sqlite`/`better-sqlite3` behind the same interface.
- **Prod-readiness (beyond the CI gate)**: k6 load + data-volume probe (esp. the O(n) client-side
  full-workout-list scans in `pickPrevSets`/`topWorkingSet`/`weeklyMuscleSets`); observability
  (Sentry/health/uptime); secrets manager; Atlas backups/PITR; a `security-review` pass.
  - **Sentry.io — Stage A (backend) BUILT + verified 2026-07-07; B/C await DSN** (`docs/sentry-integration-plan.md`).
    Stage A done: `sentry-spring-boot-starter-jakarta` 8.47.0 dep; `sentry.*` config block (blank DSN → disabled,
    `exception-resolver-order` pinned lowest so the auto-resolver never double-captures); explicit
    `Sentry.captureException` in `ApiExceptionHandler.generic()` (500-only); `SentryConfig` `beforeSend` PII scrub
    (strips Authorization/Cookie/body); `ApiExceptionHandlerSentryTest` guard (500→1 event, 4xx→0). Full gate green
    (123 tests incl. `RUN_MONGO_TESTS=1`; context boots with Sentry autoconfig). **Stage B (frontend) also BUILT
    + verified 2026-07-07:** `@sentry/react` 10.63.0 + `@sentry/vite-plugin` 5.3.0; init in `src/sentry.ts`
    (DSN-guarded) with react-router-v6 tracing + **Session Replay ON, max-privacy** (maskAllText/Inputs,
    blockAllMedia); `ErrorBoundary` reports; `vite.config.ts` gates source-map upload on `SENTRY_AUTH_TOKEN`
    (build stays green without it); `vite-env.d.ts` types the vars. Gate green (tsc clean, 139 unit tests, build
    OK, no maps leaked); runtime smoke fired a correct envelope POST to the FE ingest endpoint. Both DSNs live in
    `.env.local` (git-ignored). **Neither stage shipped yet.** Stage C = source-map upload (`SENTRY_AUTH_TOKEN`),
    `.env.example`/`DEPLOY.md` docs, release=SHA wiring, + live dashboard/replay-masking verification.
  - **Stage C (source maps / ops) also BUILT + verified 2026-07-07.** Wired into the **Docker build** (the
    shipped artifact, not CI's gate build — maps must match deployed JS): `Dockerfile` build args + BuildKit
    secret for `SENTRY_AUTH_TOKEN` (never in an image layer), `docker-compose.yml` build-args/secret + backend
    runtime `SENTRY_*`, `.env.example` + `DEPLOY.md` Sentry docs, `SENTRY_RELEASE=$(git rev-parse --short HEAD)`
    deploy step. `docker compose config` valid; frontend Docker stage builds green. **Found + fixed a
    pre-existing (non-Sentry) bug** that had broken the frontend Docker build since PR #26: `npm run build`'s
    `tsc` choked on `coach.eval.test.ts`'s `../../backend/...json` import (absent in the FE-only Docker context).
    Fix: build-scoped `tsconfig.build.json` excluding test files; `npm run build` typechecks prod code + works in
    Docker, `npm run typecheck` stays full. Gate green (139 unit + eval sweep). **All three stages built,
    verified, unshipped.** Remaining: user creates GH Actions secrets (done) / puts token in VM `.env`; live
    dashboard + replay-masking eyeball; optional GHCR release workflow to consume the Actions secrets.
  - **Live verification (2026-07-08):** added `web/DebugController.java` (`@Profile("!prod")`,
    `GET /api/debug/sentry-error` throws → real 500 → Sentry) as the deterministic backend trigger, and an
    Artifact reference map of the Sentry pipeline (`docs/`-style, hosted on claude.ai). **Frontend verification
    runnable now** (dev server :5173, no backend needed). **Backend verification BLOCKED: MongoDB Atlas is
    refusing TLS from this machine** (`tlsv1 alert internal error` across the Java driver AND the mongodb MCP) —
    almost certainly the dev IP rolled overnight and dropped out of Atlas Network Access allowlist (current IP
    120.19.96.63) — so the backend can't boot. Fix on Atlas side, then hit the debug endpoint.
  - **Concurrent-load Sentry sweep (autopilot, 2026-07-08) — 0 real bugs; app robust on both ends.** A deciding
    council (backend/arch/data/QA specialists) proposed 14 adversarial concurrency scenarios; built a
    barrier-synced backend load harness (8 scenarios × 12 users vs an isolated `workoutlogger_loadtest` backend,
    rate-limiter off, Sentry `env=loadtest`) + a 4-context frontend nav/refetch stress. **Backend: 0 unhandled
    500s.** Optimistic-lock If-Match → exactly one 200 / rest 409; dup workout & register → one 201 / rest 409;
    tenant isolation → all 404 (no leak); bodyweight atomic adds → no lost writes; settings LWW, plan-advance
    race, mixed chaos → all clean. **Frontend: 0 uncaught errors** (SQLite-WASM contention degrades gracefully,
    council F2). The council's two "CONFIRMED silent bugs" (P1 workout / P2 plan **resurrection** via a stale
    versioned save racing an unversioned delete/end) were **empirically DISPROVEN**: Spring Data auto-increments
    `@Version` on `updateFirst`/`updateMulti`, so the delete bumps version 0→1 and the stale `save()` loses with
    a 409 — verified on a live doc via the Mongo MCP. Added 2 **regression-pin** tests
    (`softDeletedWorkoutCannotBeResurrectedByAStaleVersionedWrite`, `endedPlanCannotBeResurrectedByAStaleAdvance`)
    that pass on current code; full backend gate green (`RUN_MONGO_TESTS=1` → 79 `ApiIntegrationTest`, 0 fail).
    Insight saved to memory `[[concurrency-version-aware-updates]]`. Load harnesses live in the session
    scratchpad (not committed).
    BE (`sentry-spring-boot-starter-jakarta` 8.47.0) + FE (`@sentry/react` 10.63.0). Design: 500-only capture
    via explicit `Sentry.captureException` in the generic 500 handler (4xx never sent), `sendDefaultPii:false`
    + Authorization/body scrubbing, **Session Replay ON in max-privacy mode** (maskAllText/Inputs, blockAllMedia,
    no network bodies — masking verified on a real replay before prod PII), DSN wired to env (no-ops unset).
    Scope confirmed BE+FE. Staged A/backend → B/frontend → C/ops, each a gated PR; guard test pins 500-only.
    No code changed yet — awaiting DSNs (Avishek creating the Sentry projects).
- **Subscription/entitlement layer** — gate cloud sync (flip `SYNC_ENABLED` per entitlement).
- **More UI testing tiers** — component (RTL) tests, visual regression, cross-browser E2E.
- **Tooling skills** (CLAUDE.md recommendations): `/restart-smoke`, `/diagrams`.

### Claude Code tooling gaps (learned but under-used)
- **Browser MCP** — Playwright MCP now wired in `.mcp.json` (pending activation); once live, use it to automate "verify in the running app". Atlas/MongoDB MCP wired alongside it for live DB inspection.
- **Council as a Workflow** — wrap `/council` in a Workflow to cut convene friction (skipped on small changes today).
- **Eval regression scorer** — add an eval-sweep-style baseline diff; suites pass/fail but don't report *what* regressed.
- **Project skills** — bottle recurring rituals (`/diagrams`, `/restart-smoke`).
