# UI/UX + Prod-Readiness Council Audit

*Run 2026-06-30. Method: a 5-lens code-audit council (contract-drift, backend-validation, concurrency,
security, UX) cross-checked against a **live multi-user concurrency simulation** driven against a running
backend (`:8080`) on an isolated Atlas DB (`workoutlogger_conctest`, never production). Every "verified live"
row below was reproduced against the running server; DB counts were read back with the MongoDB tooling.*

## Verdict

The single-user happy path is solid and the **security fundamentals that exist actually hold** — tenant
isolation, auth enforcement, and decimals-as-strings all survived concurrent load. But the app is **not yet
safe for an open multi-user deployment**: there is no rate limiting, and three core invariants
(one-account-per-email, one-ACTIVE-plan, monotonic plan advance) are enforced only in application code with no
DB-level or optimistic-lock backstop, so they **break under concurrency** — proven, not theorized. The
headline bug is a chain: the registration race creates duplicate accounts, which then make login **permanently
return 500** for that email.

Two CRITICAL, then HIGH→LOW. "Verified live" = reproduced on the running server this run.

> **Update (same session) — most of the audit is now FIXED across PRs #17–#21:**
> - **C1 + H1** (#17): `MongoSchemaInitializer.initialize()` runs on every web boot (`SchemaBootstrap`) → unique
>   `users.email` + partial-unique `plans {userId}|status=ACTIVE` indexes, `DuplicateKeyException → 409`.
>   Re-verified live (20 concurrent registers → 1 account + login 200; 15 concurrent createPlan → 1 ACTIVE).
> - **H3 + H4** (#18): mid-session 401 drops to login (`onUnauthenticated` seam); plan-accept surfaces errors.
> - **C2** (#19): per-IP rate limiter on `/api/auth/**` → 429 (config-gated, disabled in the integration suite).
> - **H2 + M1 + M2 + M4 + M5** (#21): `@Version` on `Macrocycle` (+409); bodyweight 1e-3 round + `@Pattern`;
>   malformed-JSON/bad-date → 400; `@Size` list caps + bodyweight-log cap; split `weekdays` 0–6.
>
> **Still open: M3** (`User` `@Version`/atomic settings — deferred to avoid 409-ing the local-first settings
> sync; needs targeted atomic `$set`/`$push`) **and the LOW tail L1–L9** (pagination, token revocation,
> Swagger-in-prod, the 401 envelope shape, `UpdateSetRequest` `@Pattern`, etc.).

---

## CRITICAL

### C1 · Registration race → duplicate accounts → login permanently bricked  *(verified live + DB)*
- **What happens:** `register()` does `existsByEmail()` *then* `save()` with no atomicity, and the only DB
  backstop — the `uniq_email` unique index — is built **only** inside `MongoSchemaInitializer`, which runs
  **only** in the one-time `import` Spring profile (`auto-index-creation: false`). A normally-booted prod
  server therefore has **no unique constraint on email**.
- **Live result:** 25 concurrent `POST /api/auth/register` with the *same* email → **23 returned 201**;
  Mongo confirmed **23 user documents** for that email. Logging in as that email then returns **HTTP 500**
  permanently (`findByEmail` → 2+ rows → `IncorrectResultSizeDataAccessException` → generic 500); a
  unique-email control logs in fine (200).
- **Evidence:** `AuthController.java:38-49`, `UserRepository.java:10-11`, `MongoSchemaInitializer.java:28,57`,
  `ImportRunner.java:98`, `application.yml:7`, `ApiExceptionHandler.java:56-60`.
- **Fix:** create the unique email index **unconditionally at every boot** (move it out of the `import`
  profile, or `@Indexed(unique=true)` on `User.email` with auto-index-creation on), and add
  `@ExceptionHandler(DuplicateKeyException) → 409` so the still-possible race loses cleanly. The index is the
  real fix; `existsByEmail` is just a friendly pre-check.

### C2 · No rate limiting anywhere → brute-force / credential-stuffing / bcrypt-CPU DoS  *(verified live)*
- **What happens:** no throttle, lockout, or backoff on any endpoint. Because login runs BCrypt on every
  attempt where the email exists, unauthenticated traffic can also drive CPU exhaustion.
- **Live result:** 80 wrong-password logins completed in **0.57 s with zero 429s**; a clean 30-concurrent
  burst returned **30/30 instant 401s, no throttling**.
- **Evidence:** `AuthController.java:35-62`, `SecurityConfig.java:23-38` (filter chain is JWT-only); no
  `bucket4j`/`resilience4j`/ratelimit anywhere in `src/main`.
- **Fix:** IP+account rate limiter (bucket4j filter or upstream WAF) on `/api/auth/**`, plus exponential
  backoff / temporary lockout after N failed logins.

---

## HIGH

### H1 · "Exactly one ACTIVE plan" not enforced → two ACTIVE macrocycles  *(verified live + DB)*
`create()` does `updateMulti(ACTIVE→ENDED)` then a separate `insert()` — no transaction, no uniqueness guard,
`Macrocycle` has no `@Version`, and `findActive()` uses `findOne()` which hides duplicates. **Live:** 15
concurrent `POST /api/plan` → Mongo confirmed **2 ACTIVE plans** for one user; `GET /api/plan` is then
nondeterministic. *Fix:* partial unique index `plans {userId:1}` filtered `{status:"ACTIVE"}` (built every
boot) → second insert throws DuplicateKey → 409/retry; or wrap end-then-insert in a transaction.
`PlanRepository.java:43-59,33-35`.

### H2 · `advance()` lost update → dropped microcycles  *(verified live)*
`advance()` = read `findActive()` → mutate in memory → `save()`, with no `@Version` (unlike `Workout`).
**Live:** 10 concurrent `POST /api/plan/advance` advanced the plan to **week 2** (one effective step) vs
**week 11** for 10 sequential calls — 9 lost updates. At a meso boundary this can silently drop the
COMPLETED transition. *Fix:* `@Version` on `Macrocycle` (retry/409) or an atomic conditional `findAndModify`
keyed on `(week, mesoIndex)`. `PlanRepository.java:68-85`, `Macrocycle.java:19`.

### H3 · 401 mid-session never updates React auth state → user stuck in a broken shell
`client.ts:51` calls `tokenStore.clear()` (localStorage only) on a 401; `setToken(null)` is never called, so
`isAuthed` stays true, the Shell keeps rendering, and every later call silently 401s. The only escapes are
Settings→Sign out or a hard reload. *Fix:* expose a module-level `onUnauthenticated()` from `auth.tsx` that
`client.ts` invokes, wired to `() => { tokenStore.clear(); setToken(null); }`.
`client.ts:50-53`, `auth.tsx:14,27`.

### H4 · Plan `accept` mutation has no `onError` → silent failure + orphaned templates
The sequential `createTemplate × N → createSplit → createPlan` mutation (`PlanPage.tsx:334-367`) defines only
`onSuccess`. Any failure leaves the button silently re-enabled, **and** templates already created before the
failing step persist with no rollback — retrying mints duplicate "Push Day"/"Pull Day" templates. *Fix:*
`onError` that surfaces the error and deletes the template ids collected so far; longer-term, an atomic
`/plan/draft` endpoint.

### H5 · Collection-field validation doesn't cascade → `@NotNull` silently bypassed
`SaveTemplateRequest.exercises` and `CreatePlanRequest.mesocycles` are `@NotNull List<…>` **without `@Valid`**,
so Bean Validation stops at the list boundary — a null `TemplateExerciseInput.exerciseId` / `MesoInput.name`
passes and is persisted. (The workout path got this right: `CreateBlockRequest.sets` is `@NotNull @Valid`.)
*Fix:* add `@Valid` to both list fields. `ApiDtos.java:96-99,150`, `DtoMapper.java:81-86`.

---

## MEDIUM

- **M1 · Bodyweight precision drift blocks the core logging loop** *(verified live)* — the client rounds
  computed bodyweight load to **1e-6** (`engine.tsx:244`) but `CreateSetRequest.weight` `@Pattern` caps at
  **1e-3**, and `SetBodyweightRequest.weightKg` has **no pattern**. Live: bodyweight `72.3456` accepted (200),
  then a bodyweight set with effective load `77.3456` → **400, whole workout rejected**; `77.346` → 201. *Fix:*
  round `engine.tsx:244` to `1e3`; add `@Pattern(DECIMAL_PATTERN)` to `SetBodyweightRequest.weightKg`.
- **M2 · Malformed JSON / invalid dates → 500 instead of 400** *(verified live for JSON)* —
  `HttpMessageNotReadableException` and bare `LocalDate.parse()` (bodyweight `recordedAt`, profile
  `dateOfBirth`, plan `targetDate`) fall through to the generic 500. *Fix:*
  `@ExceptionHandler(HttpMessageNotReadableException) → 400`; guard each `LocalDate.parse`.
  `ApiExceptionHandler.java:56-60`, `MeController.java:156-169`, `PlanController.java:54-55`.
- **M3 · `User` has no `@Version` → cross-endpoint clobber** — every `MeController` mutation is a
  full-document `save()`; a concurrent settings PUT can drop a weigh-in added by a parallel request. The
  settings "last-write-wins by updatedAt" guard only protects the settings field and is itself a non-atomic
  check-then-act. *Fix:* `@Version` on `User`, or targeted atomic `$set`/`$push`. `User.java:18-31`,
  `MeController.java:56-66`.
- **M4 · Unbounded list / body inputs** — `CreateWorkoutRequest.exercises`, `CreateBlockRequest.sets`, and
  `User.bodyweightLog` have no `@Size` cap, and there is no max request-body size → a single POST can approach
  the 16 MB doc limit / exhaust memory. *Fix:* `@Size` caps + `server.tomcat.max-swallow-size`.
- **M5 · `SaveSplitRequest.weekdays` accepts out-of-range values** — no `[0-6]` element bound; a `-1`/`100`
  persists and indexes into the 7-cell `WeekCalendar`. *Fix:* element `@Min(0) @Max(6)`. `ApiDtos.java:104`.
- **M6 · Account enumeration** — `register` returns `409 "Email already registered"` (confirms an email), and
  login runs BCrypt **only when the email exists** → a timing oracle even without the 409. *Fix:* generic
  register response / captcha; dummy BCrypt verify on absent user. `AuthController.java:39-41,57-60`.
- **M7 · Blank `SECURITY_JWT_SECRET` silently falls back to an ephemeral key** — only a WARN; in prod every
  restart logs everyone out and replicas behind a LB sign with different keys. *Fix:* fail-fast on blank
  secret outside dev. `JwtService.java:26-29`, `JwtProperties.java:11`, `application.yml:13`.
- **M8 · SPA navigation away from an active session gives no warning** — the `beforeunload` guard only covers
  hard reload/close; topbar + Cancel `nav()` leave mid-session silently (draft is persisted, but the user
  isn't warned). *Fix:* React Router `useBlocker`. `LogWorkoutPage.tsx:105-116,307`.

## LOW
- **L1** Optimistic-lock / DuplicateKey failures surface as opaque 500, not 409+retry (`ApiExceptionHandler.java:56-60`).
- **L2** `UpdateSetRequest.weight`/`loadDelta` missing `@Pattern` (inconsistent with `CreateSetRequest`) (`ApiDtos.java:84`).
- **L3** Unauthenticated 401 uses `sendError()` → `{timestamp,status,error,path}`, a different envelope than every other error (no `message`) (`SecurityConfig.java:27`).
- **L4** `GET /api/workouts` returns the full tenant history with no pagination (`WorkoutRepository.java:39`).
- **L5** 7-day tokens, no revocation / `jti` / password-change invalidation (`JwtProperties.java:14`).
- **L6** Swagger UI + `/v3/api-docs` public in every profile (`SecurityConfig.java:19-21`).
- **L7** `.cors(c -> {})` with no `CorsConfigurationSource` bean emits no CORS headers — *not* over-permissive (refuted), but a split-origin prod deploy would break (`SecurityConfig.java:30`).
- **L8** `LogWorkoutPage` renders `null` (blank screen) during first SQLite-WASM init (`LogWorkoutPage.tsx:273`).
- **L9** `saveTemplate`/`updateTemplate` use `onError: done` → a template-save failure after a saved workout is hidden (`LogWorkoutPage.tsx:260-270`).

---

## What held up under concurrency (passed)
- **Tenant isolation** — user B got **404** on user A's workout id, B's `/api/workouts` list was **empty**, no
  cross-tenant leak (the entire security model, since Mongo has no RLS). *Verified live.*
- **Auth enforcement** — no token / garbage token / forged-signature token all **401** on protected routes.
  *Verified live.*
- **Decimals-as-strings** — `100.25` round-tripped on the wire as a string, no float drift. *Verified live.*
- **Contract integrity** — all 33 `Api.*` calls map to a real controller verb/path; all shared enums match;
  every response field the UI reads is populated by `DtoMapper`; additive/nullable fields
  (`completedAt`/`endedAt`/`splitId`/`weekdays`) are null-guarded in the UI for legacy docs.
- **Granular set update path** is atomic (`$set` + `arrayFilters` + version increment) — concurrent edits to
  different sets don't lose data; the lost-update gap is only the full-document `save()` paths above.

## Recommended order of fixes
1. **C1 + H1** together — one boot-time index-creation change covers both (unique `users.email`, partial-unique
   `plans` ACTIVE) + `DuplicateKeyException → 409`. Highest blast radius, smallest change.
2. **C2** rate limiting on `/api/auth/**` (the one thing standing between this and a public URL).
3. **H2 + M3** `@Version` on `Macrocycle` and `User` + `OptimisticLockingFailureException → 409`.
4. **H3, H4, M1, M2** — user-facing correctness (broken-shell recovery, silent plan-accept failure, bodyweight
   400, error-contract 400s).

Per the project rule (*decision → executable guard, same change*): each fix lands as a **failing test first** —
the concurrency ones belong in `ApiIntegrationTest` (concurrent register / createPlan / advance asserting the
invariant), M1/M2 as boundary tests, H3/H4 as frontend tests.
