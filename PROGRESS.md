# Progress & agenda — Workout Logger

Living status file — the done / backlog tracker for this project. **Update it whenever work changes:**
finish a thing → move it to Done; pick up or think of a new thing → add it to the agenda; make a call
that isn't captured in the code → log it. Keep entries dated, newest near the top of each section.

_Last updated: 2026-07-23 (reverted auth to trivial email + password — prod SMTP-on-Railway outage fix; account wipe kept)._

> Maintenance: a global Stop hook (`.claude/hooks/check-progress.sh`) blocks the end of a turn if any
> source/`.md` file in this folder is newer than this file — it nudges whenever the tracker falls
> behind. Self-clearing: updating (or `touch`-ing) `PROGRESS.md` makes it newest again. It can't see
> conversation-only decisions, so logging those is still on you.

## Pending decisions (needs Avishek)

- **Hosted MCP + OAuth — design ratified 2026-07-21, awaiting sign-off before code** (`docs/mcp-hosting.md`
  is authoritative; council of 5). Shape: 2nd Nixpacks Railway service rooted at `mcp/`, private networking,
  Streamable HTTP stateless OAuth 2.1 Resource Server; **Spring Authorization Server in-process** in the
  backend, RS256/JWKS, `sub`=`User._id`, 3 additive Mongo collections. One real dissent (Fork 1): 4 said
  dual-accept, Security said migrate → **synthesized to a single RS256 validator** with first-party
  `/auth/login` minting RS256 via the AS key (SPA UX untouched). **Two block-ship gates:** G1 every validator
  funnels through the live `tokenVersion` check; G2 the MCP identity seam proven per-request (concurrency
  test) before retiring `resolveLocalToken`. **4 decisions LOCKED 2026-07-21** (doc §Decisions locked):
  (1) synthesized single-validator RS256, (2) `workout:read/write` + a destructive scope, (3) branded consent
  page (we own its session hardening), (4) Railway hostname for launch (recorded issuer one-way-door). Ready
  for **Phase 0** (reversible transport scaffold, no infra/auth); Railway service creation held for explicit
  go. Nothing built yet. See memory `mcp-hosting-council`.

- **Database situation — RESOLVED 2026-07-07** (`docs/db-situation.md` is authoritative). Root cause was
  DB-lifecycle hygiene, not the schema: per-run `workoutlogger_*` test DBs were never dropped (16 DBs on one
  cluster, all synthetic). Fixed — test-DB teardown wired (`TestDbCleanup` + e2e `global-teardown.ts`, both
  guarded to a `workoutlogger_*` name), 13 stray DBs dropped (cluster now 3), demo account `import@giftnote.com`
  rebuilt via the deterministic importer at a 59 kg baseline, all 8 `@example.com` test accounts purged, and the
  diagrams consolidated + moved to `docs/`. No open decision remains (only the per-environment Atlas credential,
  tracked under Operational policy below).
- ~~**Deployment target / keep the compose+tunnel escape hatch?**~~ **Decided 2026-07-14: Railway is the lone
  deployment tool.** All other deploy tooling deleted (`docker-compose.yml`, `TUNNEL_TOKEN`, every OCI/Cloudflare/
  Ampere reference); `DEPLOY.md` rewritten Railway-first. See Done.
- **Deferred coaching findings** (`docs/eval-findings.md`, evals pin current behavior under TODO):
  - Deload-floor magnitude for low-ceiling blocks (PEAK / STRENGTH-non-focus) — currently a deload can equal
    accumulation; should it step down relative to the block's own ceiling?
  - ~~Dead-band anchor weight (regression-mean vs latest) in `EnergyService`.~~ **Resolved 2026-07-21**
    (energy council): anchor is the **latest EWMA-smoothed weight** (noise-robust + current). See Done.
  - **NEW — structural-break guardrail** (energy council added it, deferred): flag estimates "provisional /
    wider-banded" for 3–4 weeks after a goal/phase change to contain the `7700 kcal/kg` early-water bias. Needs
    a segment-start marker (no such field yet); the tightened `ciWk` gate already partly contains it. Next
    energy follow-up — see `docs/eval-findings.md`.
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
- **Phase-0 hardening — SHIPPED PR #27** (`bd2100c`, 2026-07-02; first `/autopilot` run [[autopilot-harness]]).
  `WorkoutRepository.updateSet` enforces the `@Version` precondition via an optional `If-Match` header
  (stale→**409** with the server's current copy, missing/other-tenant/soft-deleted→**404**, malformed→400);
  read-only nullable `version` on `WorkoutDto`. Surfaced + fixed a pre-existing phantom-version-bump bug on a
  missing `setId`. Gate + review council green (CI: frontend + backend/Mongo + e2e).
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

- _2026-07-23_ — **Reverted auth to trivial email + password (prod outage fix).** Production sign-up **and**
  "Retake ownership" were returning "Server isn't responding" and `/actuator/health` was hanging. Diagnosed
  from Railway deploy logs (via the Railway MCP/CLI): `MailConnectException … smtp.gmail.com:587 … timeout -1`
  — **Railway blocks outbound SMTP on non-Pro plans** (confirmed in Railway docs), so the synchronous
  `JavaMailSender.send` (no connect timeout) blocked the request thread until the OS TCP timeout, exhausting
  Tomcat's pool → every endpoint (incl. health) hung. Mongo/URI/vars were all fine (verified Atlas reachable;
  the request reached the email step). Per Avishek's call ("scrap this, revert to the trivial sign in/sign up"),
  **removed the entire email path** rather than switching to an HTTPS email provider: `register` (email+password →
  account+JWT, 409 dup) + `login` restored; deleted `AuthService`, the `EmailSender` seam + all senders,
  `EmailTemplates`, `AuthChallenge`/`authChallenges`, `AuthCodes`, `AuthProperties`, `AuthSecurityValidator`,
  `UserRepository{Custom,Impl}`, and the verified-signup/recovery endpoints + their tests. **Account wipe kept**
  (password-gated, no email). Disabled Actuator's `MailHealthIndicator` (`management.health.mail.enabled=false`)
  so a leftover `SPRING_MAIL_HOST` can't re-hang `/health`. `tokenVersion` revocation seam retained (inert but
  used by wipe's token-death). Guards: `AUTH-1..3` + `AUTH-3b` + `AUTH-8` + register-TOCTOU concurrency +
  `WIPE-7..14`; frontend simplified to a login/register email+password toggle. **Adversarial review** (backend
  agent) caught one MEDIUM — login was minting the JWT at a hardcoded `tv=0` while the kept `JwtAuthenticationFilter`
  checks `tv == user.tokenVersion`, so any account with `tokenVersion > 0` (an old-reset artifact) would be
  silently locked out; fixed (`jwt.issue(u.getId(), u.getTokenVersion())`) + guarded (`AUTH-3b`). Deferred
  hygiene: the dead `spring-boot-starter-mail` dep stays in `pom.xml` (can't edit it without bundling the held
  OAuth deps; the health-indicator disable already neutralizes its one hazard); DIAGRAMS.md #16 (registration
  sequence) still shows the old verified flow. See memory `[[auth-recovery-wipe-council]]`.
  **SHIPPED: PR #60 squash-merged → `main` (`04e64e1`) → Railway auto-deployed (`3415bbcd`, Online). Outage
  FIXED and verified in prod:** `/actuator/health` 200 (was hanging); `register` 201 in 1.05s, `login` 200 in
  0.4s, `wipe` 204, login-after-wipe 401 (smoke account cleaned up — no test data left). Railway vars cleaned:
  removed `EMAIL_SENDER`, `SPRING_MAIL_HOST/PORT/USERNAME/PASSWORD`, `EMAIL_FROM`, `AUTH_TOKEN_PEPPER` (all now
  dead). CI all-green in isolation before merge.

- _2026-07-21_ — **Auth slice 2: password recovery + account wipe (built, gate + review council in flight).**
  The two deferred auth follow-ups from the 2026-07-21 auth council, both scoped by a fresh **deciding council**
  (systems-architect · backend · security · test-user; unanimous, no dissent — see memory
  `auth-recovery-wipe-council`).
  - **Password recovery ("Retake ownership"):** `POST /api/auth/recover/request` (enumeration-neutral 202,
    **never** mutates the account) + `POST /api/auth/recover/verify` (6-digit peppered `Purpose.RESET` code,
    reusing the signup challenge infra — generalized `claimSignupAttempt`→`claimAttempt(purpose)`). Verify does
    the password `$set` + `tokenVersion` `$inc` in **one atomic `findAndModify(returnNew)`** (`UserRepository`
    custom fragment), issues the JWT at the new tv (auto-sign-in) then consumes the code — so the reset revokes
    every OTHER session while this device stays in. Frontend: LoginPage gains a `recover` mode + "Retake
    ownership" link.
  - **Account wipe ("Confirm Account Wipe"):** `POST /api/me/delete {password, confirmPhrase}` → 204.
    Server-side **BCrypt password re-verify** is the real guard (wrong → 403, nothing deleted); the typed phrase
    is UI-friction only. Cascade = per-repo `deleteAllForTenant()` (bare `userId`, **no** `deletedAt` filter, so
    soft-deleted rows go too), children-first, **User doc LAST** (the commit point that 401s every token), plus
    `authChallenges` by email; idempotent/crash-retry-safe. Rate-limited (`/api/me/delete` added to
    `RateLimitConfig`). Frontend: SettingsSidebar danger zone → typed-phrase + password modal → `signOut()` on 204.
  - **Guards:** 12 new `ApiIntegrationTest` cases (RECOVER-1..6 enumeration/non-mutating/revocation-ordering/
    attempt-cap/purpose-isolation/single-use; WIPE-7..12 wrong-password/tenant-isolation/cascade-completeness/
    soft-delete-sweep/token-death/idempotency) + 2 Playwright specs (`password-recovery`, `account-wipe`).
    **Gate GREEN:** backend `RUN_MONGO_TESTS=1 ApiIntegrationTest` **110/110** (Atlas) + `AuthServiceTest` 3/3;
    frontend typecheck · 139 unit · build; both new E2E specs pass live against the packaged jar + Atlas
    (`account-wipe` needed the config's 1 retry — the known remote-Atlas `/start`-gate flake in `logSet`, not
    the wipe logic).
  - **Adversarial review council (security · backend · eval · test-user):** no CRITICAL/HIGH. Core invariants
    confirmed clean (stolen-token wipe blocked, no force-logout via /recover/request, verify is not an oracle,
    cascade scoping + atomic reset correct, all 12 guards real). **Fixed 1 MEDIUM:** email-send failures now
    swallowed in `requestSignup`/`requestRecovery` — a propagated `MailException` under `smtp` had 500'd a known
    email vs 202 for unknown (status oracle); guarded by `AuthServiceTest`. **Strengthened** the guards:
    future-proof whole-DB `userId` sweep in WIPE-9, confirmPhrase-is-UI-only (WIPE-13), no-token→401 (WIPE-14),
    RESET concurrency (RECOVER-7). **Accepted residuals** (benign, documented): concurrent double-verify tv
    double-bump (self-inflicted, same-user, UX-only); per-IP rate-limit window shared across /api/auth + /me/delete
    (availability); residual request-timing delta (known email does 2 extra challenge writes).
  - **Shipped: PR #59 squash-merged to `main` (`eda0b21`).** CI green in isolation (frontend · backend
    mvn+Mongo · e2e) — proving the slice stands alone without the still-held OAuth work. The PR deliberately
    excluded the OAuth/MCP streams + this PROGRESS entry (those stay uncommitted, awaiting their own sign-off).
  - Partially addresses the **GDPR hard-delete** operational-policy open item (a user-initiated hard delete now
    exists; retention/tombstone policy for the rest still open).

- _2026-07-21_ — **Real email delivery: `SmtpEmailSender` (unblocks prod verified sign-up).** Provider-agnostic
  SMTP over Spring `JavaMailSender` (`spring-boot-starter-mail`) — point `spring.mail.*` at any SMTP relay
  (SendGrid/Mailgun/SES/Postmark/Gmail). Active on `email.sender=smtp` (any profile), taking precedence over the
  prod `NoOpEmailSender` (now gated to `email.sender=noop|unset`). Configurable `email.from`; never logs the code;
  delivery failures propagate (500 → user re-requests). **Pepper fail-fast restored, tied to real delivery:**
  `AuthSecurityValidator` throws on a blank `AUTH_TOKEN_PEPPER` iff `email.sender=smtp` (WARN otherwise). Verified
  locally under `-Pprod` (smtp bean selected; pepper guard fires). Guard `SmtpEmailSenderTest` (S1/S2). **To turn
  on prod signup:** set `EMAIL_SENDER=smtp` + `SPRING_MAIL_HOST/PORT/USERNAME/PASSWORD` + `EMAIL_FROM` +
  `AUTH_TOKEN_PEPPER` on Railway. See DESIGN.md §6b.

- _2026-07-21_ — **Prod-boot hotfix for the verified-signup slice (PR #56).** The Railway (prod-profile) deploy
  crashed — `AuthService` needs an `EmailSender`, but the review-fix made both stubs `@Profile("!prod")` (so the
  code-logging one can't leak in prod) and left prod with no sender. Added **`NoOpEmailSender` (`@Profile("prod")`,
  logs a WARN, never logs the code)** so prod boots, and **softened the pepper prod fail-fast to a WARN** (it
  protects nothing until codes are actually delivered). Verified booting locally under `-Pprod`. **⚠ Consequence
  elevated to a blocker:** prod verified-signup **cannot deliver codes** until a real email provider is wired —
  the app runs + existing users log in, but new prod signups can't complete. **Next-up:** a real `EmailSender`
  (SendGrid/SES/SMTP; provider `EmailSender` impl + a Railway-set API key) — now the top auth follow-up, ahead of
  reset/remember-me/wipe, since it unblocks prod onboarding. Restore the pepper fail-fast when it lands.

- _2026-07-21_ — **Verified sign-up + JWT revocation hardening (`/autopilot`, council-decided, slice 1 of the auth
  overhaul).** Replaced the atomic `POST /api/auth/register` (email+password → token) with a two-step, email-verified
  flow and hardened the session model. A 5-lens council (systems-architect · security-engineer · backend ·
  data-modeler · frontend) decided the architecture; a 5-lens review council then adversarially broke it.
  **Shipped:** an `EmailSender` seam (`LoggingEmailSender` dev default `@Profile("!prod")`, `FileEmailSender` for
  E2E, `CapturingEmailSender` test bean — real delivery is a documented follow-up, stubbed this iteration);
  `POST /auth/signup/request` (enumeration-neutral 202) + `/signup/verify` (creates account + JWT); `/register`
  removed. An `authChallenges` collection (one per {email,purpose}, **all mutations atomic `findAndModify`** — no
  read-modify-write): `codeHash = SHA-256(code + AUTH_TOKEN_PEPPER)` (pepper prod-fail-fast), 15-min expiry,
  atomic 5-attempt lockout, single-use consume, atomic per-email send cap. JWT `tokenVersion` (additive, `tv`
  claim) checked once/request in `JwtAuthenticationFilter` — revokes stale tokens + wiped users. Login now runs
  constant-time BCrypt (no enumeration timing oracle). Frontend: `LoginPage` 3-step (email → code + password×2),
  202 empty-body client fix. The ~91 `ApiIntegrationTest.register()` calls migrated by rewriting ONE helper
  (request → read code off the capture → verify). **Guards:** AUTH-1..11 (incl. a concurrent-lockout test that
  fails on the old TOCTOU counter) + `AuthCodesTest` + JWT tv/legacy-token tests. **Review council caught + fixed:**
  the attempt-cap + send-cap TOCTOU (M3 read-modify-write → atomic), login timing oracle, pepper prod guard,
  code-logging-in-prod, create-before-consume ordering, missing expiry/legacy-token/send-cap guards, stale UI
  field. Backend pure 162 + Atlas ApiIntegrationTest 92 + frontend typecheck/139/build + e2e (16 pass/3 pre-existing
  flaky in `logSet`) all green; full signup verified live in the browser. Council decision in
  [[auth-system-council-2026-07]] (auto-memory). **Sign-out already existed.**
  - _Deferred (logged) follow-up slices, priority order:_ **(5) password reset / "Retake ownership"** — needs
    App.tsx unauthenticated `<Routes>` for the `/reset-password?token=` link landing; **(6) remember-me** (30d/24h
    variable JWT expiry + localStorage/sessionStorage — the `JwtService.issue(userId,tv,expiryMins)` overload is
    already built); **(7) account wipe** (hard-delete, LAST — highest blast radius; ship only with its full
    WipeIntegrationTest across all 6 collections + ordering-under-partial-failure). Also deferred: real email-provider
    wiring, and the low-severity `requestSignup` wall-clock timing residual (existing-vs-free path does different
    work — a weak enumeration side-channel; fully closing it needs async dispatch, coupled to real-delivery wiring).

- _2026-07-21_ — **Local stdio MCP server (`mcp/`) — single-user preview that transforms into the remote
  tenant-scoped one by a plumbing swap.** New TypeScript module (`@modelcontextprotocol/sdk` 1.29, zod), stdio
  transport, 21 tools over the existing REST API. Three design invariants, decided in the preceding design
  conversation: **(1) rides the REST API, never Mongo** — tenant isolation inherited for free; **(2) identity is
  injected** (`resolveLocalToken` → `getToken()` the server closes over; local = login-at-startup or a pasted JWT;
  remote later swaps to per-request OAuth, tools untouched); **(3) holds no per-user state** → stateless →
  scalable, load lands on Spring+Mongo which already handle it. Tools: 10 reads (incl. `get_energy_estimate` /
  `get_active_plan` that surface the deterministic engine rather than letting the LLM freelance training advice),
  9 writes, 2 destructive (`delete_workout`, `end_plan`, annotated `destructiveHint` so the client confirms).
  **Guard-first:** weight/loadDelta zod schemas mirror the backend `DECIMAL_PATTERN` exactly — a JS number is
  rejected before the wire. **Verified end-to-end:** 16 vitest + typecheck + build + stdio tools/list smoke (no
  backend), **AND a full live round-trip** (`scripts/verify-live.mjs`) against the backend on Atlas — authenticated
  read (84 seeded exercises), `get_energy_estimate` gated correctly on a fresh account, `log_workout` write,
  read-back with the **decimal-string invariant holding (`"82.5"` as a string, not a rounded number)**, and
  `delete_workout` cleanup. Wired into `.mcp.json` as `workout-logger` and into **CI as a new `mcp-gate`**
  (typecheck·unit·build; no services). Deliberately NOT in the `Dockerfile`/Railway image — it's a local dev tool.
  Deferred by design: the remote HTTP + OAuth + hosting deployment (the expensive ~60%, gated on real user demand
  — a plausible paid "bring your own agent" tier). Also added a **"05 · MCP" section to `docs/setup-brief.html`**
  (the interactive mentor-review brief) and republished the artifact in place. (Verifying meant driving the new email-verification signup flow
  — the uncommitted `AuthService.java` WIP, see [[auth-system-council-2026-07]] — via the dev `LoggingEmailSender`
  code in the app log; the frontend `client.ts` still calls the old `/auth/register`, now 404.)

- _2026-07-21_ — **Coach energy model brought up to its designed spec (`/autopilot`, council-decided).** Closed the
  gap between the shipped Layer-2 `EnergyService` and `docs/coach.md`. A deciding council (energy-analyst ·
  sports-data-expert · data-modeler · systems-architect) ruled: **EWMA over Kalman** (a fixed-gain EWMA *is* the
  steady-state scalar Kalman — no unfittable magic numbers at ~1-user scale); **workout energy as a separate
  additive display term** (`MeController` passes a trailing-7d session count as a plain int so `EnergyService`
  stays pure; `neatBmrKcal`+`workoutKcal` in the DTO; PAL not rescaled); **dead-band anchored to the latest EWMA
  weight** (resolved the deferred finding); **female gate 28 days** (was a buggy 21); **UNSPECIFIED −78** kept +
  documented (maintenance ±12%); a **5-level status ladder** INSUFFICIENT_DATA → TREND_ONLY → PHASE_LOW/MEDIUM/
  HIGH (only PHASE_HIGH feeds the planner clamp); **`modelVersion` + `EnergyModel`** versioned constants.
  **Implementer deviation (evidence-logged):** the slope is **Theil–Sen** (median of pairwise slopes), not the
  council's literal OLS-on-EWMA-smoothed — the latter empirically attenuated a clean +0.40 kg/wk trend to +0.25
  and inflated its CI; Theil–Sen is unbiased, zero-tunable, and one wild weigh-in can't move the rate. CI is
  honest raw scatter about the robust line (Student-t, df=n−2). Guards `E8`–`E21` (failing-first) + an
  `ApiIntegrationTest` endpoint/tenant guard; `CoachCard` renders all 3 states (verified live). **Review council
  (energy-analyst · eval-engineer · backend-eng · test-user) caught + fixed a HIGH bug:** the `TREND_ONLY` gate
  was absolute, suppressing decisive one-sided-CI cuts/bulks from ever reaching PHASE_HIGH — fixed to
  straddle-only (`E21` regression), plus the `600–600` kcal render, `−0.00` rate, stale Javadoc, df-31 cliff.
  Deferred (logged in `docs/eval-findings.md`): a structural-break "provisional" flag, same-day weigh-in dedup,
  a formal Theil–Sen CI, and pill-prominence UX. Backend `mvn test` + Atlas `ApiIntegrationTest` + frontend
  typecheck/test/eval/build all green. See `docs/coach.md` "Energy model", `docs/eval-findings.md`, DIAGRAMS #15.

- _2026-07-16_ — **Interactive deploy/infra brief for mentor review — `docs/setup-brief.html`.** A single-file,
  self-contained (no external deps, no network) interactive page: tabbed sections (Overview · Hosting · Data &
  Monitoring · Build method · Limitations), a clickable request-path diagram (Browser → Railway → App → Atlas +
  the error → Sentry → Slack branch, each hop explains its wiring), a step-through deploy pipeline, and an
  expandable breakdown of the agentic Claude Code workflow (council · `/autopilot` · `/gate` · sub-agent
  delegation · `qa-run` · hooks+memory). Deliberately in the app's own dark "Iron Instrument" palette (pulled from
  `frontend/src/styles.css`). Scope is setup + honest limitations + build method — no product/code internals.
  Facts sourced from `DEPLOY.md`, the `Dockerfile`, `application.yml`, and a live health check (UP). Also shared
  as a Claude Artifact. **Note:** the "LIVE · UP" pill is a static verified value, not a real-time ping (a
  self-contained page can't call out).

- _2026-07-16_ — **QA-01 fixed via `/autopilot`: client-triggerable 4xx no longer 500s or floods Sentry.**
  A wrong HTTP method / bad Content-Type / unsatisfiable Accept on a mapped `/api` route was hitting the
  `generic(Exception)` catch-all — the sole `Sentry.captureException` site — returning 500 + a false Sentry
  event on every scanner/mis-verbed probe (root cause: `ExceptionHandlerExceptionResolver` runs the
  `@ExceptionHandler(Exception.class)` catch-all *before* Spring's `DefaultHandlerExceptionResolver`, so
  framework dispatch exceptions were swallowed into 500). Fix: three specific handlers in `ApiExceptionHandler`
  — `HttpRequestMethodNotSupportedException` → **405** (+ RFC-7231 `Allow` header), `HttpMediaTypeNotSupportedException`
  → **415**, `HttpMediaTypeNotAcceptableException` → **406** (forced JSON body) — each returning before `generic()`.
  **Deciding step skipped** (mechanical, precedented by the shipped #40/#44 not-found fixes). **Review council
  (3 lenses) earned its keep:** backend-eng confirmed correctness/ordering (hierarchy-closest match, not
  declaration order); systems-architect found the 406 gap (only reachable remaining one — no `@RequestParam`/
  required `@RequestHeader`/multipart/`@Validated` on the surface, so the other candidate exceptions are
  unreachable); eval-eng caught that a **status assertion is a false green** for the anti-flood property — a
  bad `Accept` *already* returned 406 to the client while `generic()` ran and fired Sentry underneath (the 500
  body couldn't be written as XML, re-negotiation surfaced the 406, masking the capture). The
  dispatch-level capture guard proved this empirically (RED before the 406 handler, GREEN after). Guards: 3
  unit cases (`ApiExceptionHandlerSentryTest`, now 6) + 2 integration cases (`ApiIntegrationTest`, now 83) incl.
  `clientErrorsFireNoSentryEventAtDispatch` (counts real-dispatch Sentry captures = 0 across 405/415/406).
  Backend gate green (`RUN_MONGO_TESTS=1 mvn test`, isolated Atlas DB, auto-dropped); frontend untouched.
  Lesson saved to memory [[sentry-flood-unhandled-framework-exceptions]]. **Not yet committed** (awaiting the
  ship call). Details: `docs/qa-findings-hosted.md` (QA-01).
- _2026-07-15_ — **Full UI/UX QA sweep of the hosted prod app** (`https://workout-logger.up.railway.app`)
  via the ui-bug-finder `qa-run` skill, Playwright MCP against `workoutlogger_prod` (prod + strict-cleanup
  ledger). Report: **`docs/qa-findings-hosted.md`**. Every finding reproduced before logging. **1 MODERATE
  bug (QA-01):** any unmapped HTTP method on a *mapped* `/api` route returns **500 "Internal error"** instead
  of **405** (verified on 6 route/method pairs; unmapped paths correctly 404) — `HttpRequestMethodNotSupportedException`
  falls through to the generic `Exception` handler, and each 500 fires a Sentry event (same class as the shipped
  #40/#44 not-found fixes). **5 MINOR:** core logging inputs (weight/reps/RPE) lack programmatic labels (a11y);
  raw validation message leaks the field path (`exercises[0].sets[0].weight …`) + no client-side weight bound;
  pervasive "1 exercises · 1 sets" pluralization; in-session Discard has no confirm even with a completed set;
  icon buttons named only by glyph. **Verified holding:** Decimal128-as-string end-to-end (workout + edit +
  bodyweight, incl. Mongo `$numberDecimal`), tenant isolation (cross-tenant GET/DELETE → 404), auth (401 on
  no/garbage/forged token), XSS refuted (React escaping), network-failure resilience (friendly error + draft
  preserved in-page AND across reload via beforeunload + Resume/Discard + retry works), F01 not-found fix live,
  coaching engine (plan builder / volume landmarks / energy gate) renders correctly. **Cleanup partial:** 2 test
  workouts deleted (204); 2 test accounts + 1 custom exercise + 1 bodyweight entry **remain on prod** (no
  delete-account/exercise endpoint — they 500 per QA-01; Mongo MCP is read-only) — needs a manual Atlas/mongosh
  purge (ids + snippet in the session cleanup ledger). Added the Railway origin to `.mcp.json`'s Playwright
  `--allowed-origins` so the hosted site is reachable for future QA.
- _2026-07-14_ — **Railway is now the lone deployment tool; all other deploy tooling deleted.** Removed
  `docker-compose.yml` (the app + `cloudflared` stack), the `TUNNEL_TOKEN` var, and every Cloudflare / Oracle-Cloud
  (OCI) / Ampere reference from `.env.example`, the `Dockerfile` comments, and `application.yml`. `.env.example` is
  reframed around Railway's Variables tab. Nothing in CI or tooling referenced compose, so nothing broke.
  **Left the `Dockerfile`'s HEALTHCHECK + `curl` install in place on purpose** — deleting compose removed its only
  consumer and it hardcodes 8080 while the app binds `$PORT` (so it's inert on Railway), but Docker isn't available
  in this environment to verify an image build, and CI doesn't build the image either — so an unverified Dockerfile
  edit could only be caught by a failed Railway deploy. Documented in-file as inert; remove it when a build can be
  verified.
- _2026-07-14_ — **`DEPLOY.md` rewritten Railway-first.** The doc still walked a reader through provisioning an
  Oracle Cloud VM + a Cloudflare Tunnel + manual `docker compose up` — a path that was **never executed** and was
  abandoned 2026-07-09. Anyone following it would have built infrastructure the app doesn't use. Now documents the
  real deploy: push to `main` → Railway builds the `Dockerfile` from GitHub → container binds `$PORT` → Atlas +
  Sentry. Keeps the runtime-vs-build-time variable split (`VITE_SENTRY_DSN` must be a build var — Railway maps
  service vars onto Dockerfile `ARG`s) and the four hard-won **Railway gotchas** (bind `$PORT`; the builder rejects
  BuildKit secret mounts so `SENTRY_AUTH_TOKEN` is a build ARG; a `${{RAILWAY_GIT_COMMIT_SHA}}` variable *reference*
  silently resolves to `""` — declare it as an `ARG`; an empty-but-set var defeats a Spring default). Verified the
  live service while writing it (health UP, SPA + `/start` 200, `/api/me` 401). The compose/`cloudflared`
  scaffolding is retained + flagged as an open call rather than deleted, since it still works for self-hosting.
- _2026-07-14_ — **Repo cleanup + doc-leanness pass (PR #46, `735a4e0`).** Goal: as lean as possible without
  sacrificing Claude's context, the human mental model, or functionality. **Cruft: ~250 MB reclaimed** — two
  abandoned agent worktrees in `.claude/worktrees/` (206 MB, removed via `git worktree remove`), `backend/target/`,
  `frontend/test-results/`, `.playwright-mcp/` session logs, an orphaned root `node_modules/.vite`, and 14
  `.DS_Store`. **Docs: −736 lines** (99 insertions / 835 deletions, markdown only — no product code, tests, or
  config touched; all three CI gates green). Deleted 4 completed one-off process docs (sentry-integration-plan,
  planner-council-simulation `.md`+`.pdf`, uiux-prod-audit) — git history retains them; **kept `db-situation.md`**
  because live test code (`TestDbCleanup`, `global-teardown.ts`) cites it as rationale. Consolidated duplicated
  facts to one authoritative home: `CLAUDE.md` (always-loaded) now points at `DESIGN.md`/`docs/coach.md` for the
  coaching engine, eval catalog, local-first seam and component list, keeping only the file map — the short safety
  invariants (Decimal128-as-string, tenant isolation, `setId`) stay duplicated on purpose, that repetition is
  load-bearing. **The redundancy had already drifted into real errors, now fixed:** the eval catalog was recorded
  as "R1–R18/R10–R22" in three places (actually **R1–R40**); Playwright was "3 specs / 6 cases" (actually **11 /
  22**); an orphaned PROGRESS fragment claimed "No code changed yet — awaiting DSNs" directly beneath the "LIVE ON
  RAILWAY, verified in prod" entry; eval decisions D1–D5 were called deferred though they're resolved;
  `atlas-mcp.md`'s `.mcp.json` block didn't match the live file; `db-situation.md`'s "Open calls" were all already
  answered. Captured the whole procedure as a **global `repo-clean` skill** (`~/AvisheksIntelligence/.claude/
  skills/repo-clean/`) — two-tier (auto-delete regenerable cruft; survey-then-propose for tracked docs), with a
  hard stop against ever editing product code. Also set local `main` to track `origin/main` (was untracked).
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
  Atlas IP allowlist (0.0.0.0/0), `fly secrets set MONGODB_URI/SECURITY_JWT_SECRET`,
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
- _2026-06-30_ — **UI/UX + prod-readiness council audit**. 5-lens code council
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
- _2026-06-25_ — **Reliability hardening — the council's 3 HIGH hazards**.
  Built by 3 synchronous sub-agents on disjoint files. (1) **Input validation** — mirrored `UpdateSetRequest`
  bounds onto `CreateSetRequest` (reps `@Min/@Max`, rpe, a weight `@Pattern`) + cascade `@Valid` so the bulk save
  path actually validates; `ApiIntegrationTest` asserts bogus reps/rpe → 400 (35/35). (2) **Error/offline states**
  — new `ErrorBoundary` (wraps the shell) + shared `QueryError` (Retry); 10 query-gated pages now render `isError`
  instead of spinning or seeding from `?? []`. (3) **Durable in-gym logging** — the live workout draft persists to
  the `LocalStore` seam (debounced) with a Resume/Discard prompt on reload + a `beforeunload` guard; plus a
  non-blocking large-jump weight warning. Gate green: tsc · 113 unit (+13) · eval 240/240 · build · backend 35/35
  · **e2e 6/6**. Verified live: started a session → reload fired the beforeunload guard → restore prompt rendered.
- _2026-06-25_ — **Council planner-simulation** (8-page PDF) — 44-agent
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

- **QA sweep follow-ups (2026-07-15, `docs/qa-findings-hosted.md`)** — ~~(1) QA-01 wrong-method → 405~~ **DONE
  2026-07-16** (405/415/406, see Done). Remaining: (2) a11y — add `aria-label`/`<label>` to the set-row inputs
  + plan comboboxes + icon buttons; (3) humanize the weight validation message + add a client-side max;
  (4) fix the "1 exercises/1 sets" pluralization; (5) confirm-on-Discard when a session has a logged set.
  ~~**Also:** purge the residual prod test accounts + custom exercise~~ **DONE 2026-07-16** (2 accounts +
  169 exercises + 2 workouts + embedded bodyweight purged from `workoutlogger_prod` via a temporarily-writable
  Mongo MCP, all verified count=0; MCP flipped back to read-only).
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

- **Council planner-simulation findings** (2026-06-25) — 44-agent lifecycle sim; verdict: *the coaching engine is
  sound, the UI doesn't explain it*. **All actioned** — the reliability hazards (input validation, error/offline
  states, durable draft persistence), planner fixes (session-total cap, cross-block e1RM re-anchor, silent-reset
  fix, duration-truncation), and surfacing quick wins are in the Done entries dated 2026-06-25 and later.

- **Edit-time recovery notes use slot primary muscles only** — `scheduleNotes` (the live warning when you drag a
  session in the builder) reads muscles off rendered slots, so it's slightly less sensitive than the synergist-aware
  auto-scheduler (`scheduleWeek`/`effOf`). Fine for live feedback; if exact parity is wanted, feed synergist info to
  `scheduleNotes` (e.g. pass the catalog or precompute per-template effective muscles). Small, low priority.

- **Non-dismissible recovery-adjacency warning** — "Side delts lands on back-to-back days" on every builder load.
  R36 made `orderForRecovery` **provably adjacency-optimal** (exhaustive over ≤6 days; failing-guard-first, gate
  green) — but proved the warning is **mathematically unavoidable**: side delts is trained on 3 of 4 days, and 3
  days can't be mutually non-adjacent in a 4-slot week, so even the optimal order forces ≥1 back-to-back.
  **Still open — killing the noise needs a different lever:** (A) split actionable "Catalog gaps" from advisory,
  dismissible **recovery notes**; or (B) reduce side-delt effective frequency by design. Awaiting the call.
- **Offline-first for the full data model** — extend the `LocalStore` pattern from settings to
  workouts/exercises/templates/plans with the planned delta-sync (`updatedSince` + `deletedAt` tombstones +
  an outbox). The deferred mobile phase; large, warrants a council. Native shells swap in
  `expo-sqlite`/`better-sqlite3` behind the same interface.
- **Prod-readiness (beyond the CI gate)**: k6 load + data-volume probe (esp. the O(n) client-side
  full-workout-list scans in `pickPrevSets`/`topWorkingSet`/`weeklyMuscleSets`); observability
  (Sentry/health/uptime); secrets manager; Atlas backups/PITR; a `security-review` pass.
  - **🚀 LIVE ON RAILWAY (2026-07-09):** **`https://workout-logger.up.railway.app`** — project
    `successful-nurturing` / service `workout-logger` (renamed from `modest-balance` mid-setup, which changes the
    generated domain), prod profile, Atlas DB **`workoutlogger_prod`** (fresh, isolated from dev). Four code
    fixes: **#36** frontend Docker build (`tsconfig.build.json`), **#37** `server.port: ${PORT:8080}`, **#38**
    `SENTRY_AUTH_TOKEN` as a build ARG (Railway's builder rejects `--mount=type=secret` — only `type=cache`),
    **#40** `NoResourceFoundException` → 404 (missing `/favicon.ico` + `/assets/*` were 500ing and firing a
    Sentry event on *every browser page load*), **#44** unknown `/api/*` → 404 JSON (below).
    Railway vars: `MONGODB_URI`, `SECURITY_JWT_SECRET`,
    `SPRING_PROFILES_ACTIVE=prod`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_TRACES_SAMPLE_RATE`,
    `VITE_SENTRY_DSN` (Railway maps service vars onto matching Dockerfile `ARG`s, so this bakes into the bundle).
    **Both ends of Sentry are now live** (backend 500-capture + frontend errors/masked Replay; DSN verified in the
    served JS). Verified live: health UP, SPA + `/start` 200, `/api/me` 401, `/favicon.ico` + missing assets 404,
    zero backend 500s, register→JWT→84 seeded exercises→workout 201, indexes created, smoke account cleaned.
    Railway MCP wired in `.mcp.json` (auth via `railway login`; the API tokens tried were invalid).
    **Release grouping fixed (#42):** a Railway variable *reference* `${{RAILWAY_GIT_COMMIT_SHA}}` resolves
    against the service's configured vars (no `RAILWAY_GIT_*` there) and silently stores `""`. Declaring
    `ARG RAILWAY_GIT_COMMIT_SHA` instead makes the builder pass it through — verified: the build ran with
    `VITE_SENTRY_RELEASE="7052f5e…"` and that SHA is in the served bundle. Backend mirrors it at runtime via
    `release: ${SENTRY_RELEASE:${RAILWAY_GIT_COMMIT_SHA:}}` (an empty-but-set var would defeat a Spring
    default, so the two blank vars were deleted from the service).
    **SPA catch-all swallowed unknown `/api` routes (#44).** Found in prod while confirming the `!prod`
    `DebugController` was absent: an authed `GET /api/debug/sentry-error` returned **200 `text/html`**, not 404.
    `SpaForwardController`'s extensionless `{p1}/{p2}/{p3}` catch-all matched any *unmapped* `/api` route of 1–3
    segments once auth passed and forwarded it to `index.html` (4+ segments escaped, so `/api/does/not/exist`
    already 404'd). Its javadoc claimed `/api/**` "never reaches here" — true only when a mapping exists. A
    typo'd/removed endpoint therefore looked like a success and any JSON client (incl. our `client.ts`) would
    choke parsing HTML. Auth-gated, no data leak. Fix: negative lookahead excluding `api|actuator|v3|swagger-ui`
    from the first segment → falls through to `NoResourceFoundException` → the #40 handler. Guard-first (test
    fails on old code); the pre-existing `src/test/resources/static/index.html` makes the SPA forward genuinely
    resolve in tests, so deep links are pinned too. Gate green (81 `ApiIntegrationTest`); verified live.
    **Sentry confirmed end-to-end in prod (2026-07-09).** Frontend: a real uncaught error on the live site →
    Sentry ingest returned **HTTP 200 on all 4 envelopes** (error + session + replay). Backend: temporarily
    flipped `SPRING_PROFILES_ACTIVE` off `prod` (it gates only the M7 blank-JWT fail-fast + `DebugController`;
    the secret is set, so tokens stayed valid), fired `/api/debug/sentry-error` → **500 captured exactly once**,
    the 404 control captured **zero**, no transport errors; profile restored and the endpoint verified gone.
    **Open items:** (1) Source-map upload is
    off (no `SENTRY_AUTH_TOKEN`) so frontend stack traces stay minified; setting it as a Railway var would expose
    it in build logs + `docker history` (the build-ARG trade-off). (2) **Owner still to eyeball in the Sentry
    dashboard:** the backend event carries no `Authorization`/body (the `beforeSend` scrub), and the frontend
    replay masks email/password inputs. Neither is observable from a session.
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
- **Subscription/entitlement layer** — gate cloud sync (flip `SYNC_ENABLED` per entitlement).
- **More UI testing tiers** — component (RTL) tests, visual regression, cross-browser E2E.
- **Tooling skills** (CLAUDE.md recommendations): `/restart-smoke`, `/diagrams`.

### Claude Code tooling gaps (learned but under-used)
- **Browser MCP** — Playwright MCP now wired in `.mcp.json` (pending activation); once live, use it to automate "verify in the running app". Atlas/MongoDB MCP wired alongside it for live DB inspection.
- **Council as a Workflow** — wrap `/council` in a Workflow to cut convene friction (skipped on small changes today).
- **Eval regression scorer** — add an eval-sweep-style baseline diff; suites pass/fail but don't report *what* regressed.
- **Project skills** — bottle recurring rituals (`/diagrams`, `/restart-smoke`).
