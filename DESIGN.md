# Workout Logger — Design (v5, as-implemented)

> Council synthesis over the real Strong CSV (`strong_workouts.csv`), every empirical claim verified
> against the raw file, then built out. The web app (Spring Boot backend + React frontend) is live;
> this documents the as-implemented design. Mobile and cardio remain future work.

## 0. Stack & directives (settled)

- **Backend:** Java + Spring Boot (Spring Data MongoDB, Spring Security/JWT).
- **Frontend:** React (Vite) + CSS SPA over a REST API; OpenAPI-generated TS client.
- **Database:** MongoDB. **Decimal128** for weights.
- **Importer:** one-off Java service. Import = **one-time bootstrap**; in-app edits win thereafter.
- **Import scope:** 4 templates — Anterior/Posterior × Upper/Lower focus.
- **Exercise names:** raw string; **equipment is a separate field** (parsed from the name suffix at
  import, user-settable in the UI). `category` is `STRENGTH` (cardio later).
- **Mobile:** later, after web is fully built. Keep cheap future-proofing; **don't build the sync
  engine now**.
- **Bodyweight backfill:** single current bodyweight applied across history (rows flagged estimated).

## 1. Verified data facts (scoped to the 4 templates)

1,533 set rows · 47 sessions · 30 exercises · 2026-03-12 → 2026-06-07 (~3 months) ·
195 warmup (`W`) rows · 612 fractional-kg rows · `weight=0` on 61 rows (**Pull Up 29, Knee Raise
(Captain's Chair) 32**) · Pull Up logged at `0` and `+10` (19 weighted rows) · RPE on 717 rows
(~47%, clustered 9/10) · Notes on 189 rows (form/equipment cues only — **zero contain "assist"**) ·
Workout Notes 100% empty · cardio (Distance/Seconds) **100% zero** · dates carry **`U+202F`** before
AM/PM · 4 duration shapes (`#h #m`,`#h`,`#m`,`#s`) · no per-set timestamps (all sets share session
start) · **no bodyweight value anywhere in the file**.

## 2. MongoDB document model

Session = one document embedding its exercises and sets (verified: ≤41 sets / ≤13 exercises per
session, no exercise re-entry → low-KB docs, far under 16MB; embedding is the correct aggregate).

```jsonc
// users
{ _id, email, currentBodyweightKg: Decimal128|null,
  bodyweightLog: [ { recordedAt, weightKg } ],   // see §5; cap/archive if it ever grows large
  schemaVersion, createdAt, updatedAt }

// exercises  (per-user catalog)
{ _id, userId, name, nameKey,           // nameKey = NFC+casefold+trim; display uses name
  isBodyweight, equipment, category,    // equipment enum (BODYWEIGHT<=>isBodyweight); category=STRENGTH
  defaultUnit, schemaVersion, createdAt, updatedAt, deletedAt }

// templates  (1+ exercises, each with a planned set count)
{ _id, userId, name, exercises: [ { exerciseId, name, position, sets } ], schemaVersion, createdAt, updatedAt }

// splits  (named grouping; many-to-many with templates)
{ _id, userId, name, templateIds: [ ... ],
  weekdays: [ 0..6, ... ],                // weekday per template slot (0=Mon…6=Sun); nullable — old docs omit it
  schemaVersion, createdAt, updatedAt }

// workouts  (core collection)
{ _id, userId, version,                 // version = @Version optimistic lock
  startedAt, startedAtOffset, durationSeconds, rawDurationText, templateId,
  exercises: [
    { exerciseId, name, position, note,         // embedded name = immutable historical snapshot
      sets: [
        { setId,                                // stable per-set identity — NOT `id` (Spring maps id→_id)
          orderIndex, setType,                  // setType: warmup|working|drop|failure
          weight: Decimal128,                   // canonical effective load
          loadMode, loadDelta,                  // bodyweight decomposition — see §5
          weightUnit, reps, rpe, note,
          loggedAt, estimated,                  // estimated=true for backfilled bodyweight rows
          rawImport, importRowIndex } ] } ],
  schemaVersion, createdAt, updatedAt, deletedAt }
```
*Cardio (`distanceM`,`durationS`) omitted from the v3 write contract — 100% unused; add (purely
additively) when a cardio exercise first exists, so the TS client isn't bloated with untested fields.*

**Indexes:** `workouts {userId, startedAt:-1}`; `workouts {userId, 'exercises.exerciseId', startedAt:-1}`
(seeds last-working-set); `exercises {userId, nameKey}` **partial unique** on `{nameKey:{$exists:true}}`
(Mongo forbids `$exists:false` in a partial filter); `workouts {userId, startedAt}` **unique** (import
idempotency key, computed from normalized instant).

**$jsonSchema validators** per collection: `weight` bsonType `decimal` (reject doubles → no float
drift); `setType`/`loadMode` enums; `rpe` int 1–10; `reps`/`durationSeconds` ≥ 0; required
`userId`/`startedAt`.

### 2a. Concurrency mechanism selection (council-ratified, audit M3)

The codebase deliberately carries THREE concurrency mechanisms; pick by the write's shape, never by
habit. **Read-modify-write `save()` on a shared document is forbidden once it has more than one write
path** — that pattern is what lost concurrent User writes (a settings PUT dropped a parallel weigh-in).

1. **Whole-doc `@Version` + If-Match → 409** (Workout set-PATCH, Macrocycle `advance()`): only when the
   write is a genuine last-writer-must-know contest AND the client can act on a conflict (re-read /
   rebase / prompt). Never put a 409 on a fire-and-forget path.
2. **Domain-timestamp LWW, always 200, never 409** (settings `settingsUpdatedAt`): fire-and-forget sync
   writes where newest-wins IS the contract. The newest-wins check must live INSIDE the update's match
   (`settingsUpdatedAt <= incoming` ANDed into the `updateFirst`), not in a read-then-save; a superseded
   write returns the persisted winner so the caller can reconcile.
3. **Targeted atomic op scoped `{_id, tenant}`** (`MeRepository`: `$push`/`$pull`/positional-`$`/
   per-field `$set`): disjoint subtrees or key-addressable embedded entries. Preconditions (the log cap,
   entry existence) go INSIDE the match — `$expr $size` for the cap, `bodyweightLog.entryId` for entry
   ops — so a miss matches nothing (404) instead of phantom-bumping `updatedAt`. Check
   `getMatchedCount()`, not `getModifiedCount()` (a no-op write matches but modifies nothing).
   Derived values that can't be recomputed atomically alongside the op (`currentBodyweightKg`) are
   **derived at read** (`BodyweightMath`), not stored.

Known accepted residual: profile's set-once `initialIntakeAt` is a bounded two-op sequence (atomic
per-op, not as a unit); a crash between the ops leaves kcal set with no anchor until the next
kcal-bearing PUT (field is write-only today). Embedded ids are never named `id` (Spring maps embedded
`id`→`_id`, silently breaking dotted-path queries): `setId` on sets, `entryId` on bodyweight entries.
Legacy rows are backfilled once at startup by `BodyweightEntryIdBackfillRunner` — never on the request
path, and via a per-doc **compare-and-swap** on the array snapshot (Tomcat serves before
`ApplicationReadyEvent`, so a blind `$set` could clobber a boot-window write; a CAS miss retries next
pass/boot). The legacy `currentBodyweightKg` mirror is served only for import-era accounts that have
never written a weigh-in; every bodyweight write `$unset`s it in the same atomic op, so a deleted last
real entry yields null — never a resurrected import weight.

## 3. The 6 high-impact council fixes (adopted) + input-validation invariant

1. **Decimal128 as a string end-to-end** *(highest-leverage correctness fix)*. Store native
   Decimal128 (for aggregation); serialize `weight`/`loadDelta` as JSON **strings** (`type: string`
   in OpenAPI), `BigDecimal` in Java, a decimal type in TS. A JS-`number` client silently rounds the
   612 fractional rows and corrupts every PR / "last weight" / copy-last-set. Never index/aggregate
   the stringified form (`'9' > '10'` lexically).
2. **Last-working-set is a correctness bug, not a tuning task.** All sets in a session share
   `startedAt` and `loggedAt` is null on import → `sort startedAt desc limit 1` is **non-deterministic**.
   Fix: `match userId+exerciseId → unwind → filter(working, not deleted) → sort(startedAt desc,
   orderIndex desc) → limit 1`, seeded by the multikey index. Verify with `explain()`.
3. **Centralized `userId` isolation choke point** *(top operational risk — no RLS backstop)*. A base
   repository / aspect ANDs the JWT-principal `userId` into **every** find/update/delete/aggregation,
   including positional `arrayFilters` updates. `_id` is routing only, never authorization. Ship with
   a test proving a forged/omitted `userId` returns nothing — **before** any feature code.
4. **`@Version` optimistic lock + targeted `arrayFilters` writes** (keyed by `(workoutId, setId)`,
   not array position — avoids index-shift, not `exerciseId` alone — ambiguous). Prevents lost
   updates from concurrent in-flight set saves — a **today** React problem, not just offline.
5. **Client-minted `_id` authoritative + upsert idempotency.** POST upserts on the client `_id`
   (scoped by `userId`), server never reassigns. Stable React optimistic keys + retry-safe POSTs +
   future offline-mint, for free. (Keep `ObjectId`; the UUIDv7 swap debate resolved — `_id` is
   routing, ordering is `(startedAt, orderIndex)`.)
6. **ISO-8601 on the wire.** Every datetime serialized strict ISO-8601 UTC (no AM/PM, no `U+202F`)
   so the TS client never sees the narrow space. Also normalize `U+202F` **before** computing the
   import idempotency key, or a re-run mints a different key and duplicates the session.
7. **`CreateSetRequest` Bean Validation (bulk save path).** `reps @Min(0) @Max(1000)`,
   `rpe @Min(1) @Max(10)`, `weight`/`loadDelta` `@Pattern` (decimal string ≤ 9999), with cascade
   `@Valid` on `CreateWorkoutRequest.exercises → CreateBlockRequest.sets`. Previously only the
   rarely-used `UpdateSetRequest` was validated, so a malformed weight string on the POST path silently
   poisoned e1RM and progression. **Every new request record touching a set must carry the same
   constraints** — the `$jsonSchema` validator is the DB backstop, not the first line.

## 4. Importer spec (Java)

- Filter to the 4 templates; **normalize `U+202F`/`U+00A0` → ASCII space before date parse**
  (🚨 silent total-failure bug, affects Java too); parse 12-h dates + all 4 duration shapes;
  `durationSeconds` is always populated and authoritative for display; handle CRLF; NFC-normalize
  names, keep verbatim, derive `nameKey`.
- 30 exercise docs; seed `isBodyweight` on the **verbatim** `Pull Up` and `Knee Raise (Captain's
  Chair)` strings (not the shorthand "Knee Raise", which has zero rows).
- **Gate/disable the "Assisted N" note-parser** — zero scoped notes contain assist; it fires on
  nothing and would silently stamp bodyweight onto the 61 zero-weight rows.
- **Flag every backfilled bodyweight row `estimated: true`** (provenance), so the UI can mark
  importer-guessed values distinctly from real history.
- One workout doc/session (idempotency key = `userId` + normalized `startedAt` instant; upsert);
  define partial-load behaviour on mid-import crash (re-runnable upsert, unique index enforced).
- Reconstruct the 4 templates from the most-recent instance of each name; lift exercise-scoped notes
  onto the embedded exercise `note`.
- **Assert: 1,533 sets · 47 sessions · 30 exercises · 195 warmups · 61 bodyweight rows.** Fail loud.

## 5. Bodyweight model — ✅ DECIDED (refined single-field)

Confirmed: the refined model below — single canonical effective-load field, delta-based entry,
hidden `loadDelta`/`loadMode` for analytics, prompt-at-import bodyweight flagged `estimated`.
Verified against the data: your Pull Up `Weight` column holds `0`/`+10` (the *added delta*); you
never logged a cumulative `70`, and no bodyweight value exists anywhere in the file.

- **Storage/display:** keep `weight` as the single canonical **effective load** (`bodyweight ± delta`)
  — your directive, intact.
- **Entry:** the input widget takes the **delta** (`+10`, or `assisted 22.5`) with an added/assisted
  toggle; the app computes & shows cumulative as a derived caption. (Entering `70` mid-set is a
  translation tax you never did in Strong.)
- **Recoverability:** also persist `loadMode` (`bodyweight|added|assisted`) + `loadDelta` (~16 bytes/
  set). Without it, once your bodyweight changes, a 2 kg body-mass gain is indistinguishable from a
  +2 kg strength gain — permanently, because import is a one-time bootstrap. This is the cheap
  insurance against analytic loss.
- **Placeholder:** for a new bodyweight exercise, prompt for current bodyweight (or fall back to last
  delta) rather than seeding from an invented constant; imported bodyweight rows render as
  `estimated`.

**Placeholder (decided):** prompt for current bodyweight once at import, apply across history, and
flag those rows `estimated: true`; going forward, live logs snapshot the latest `bodyweightLog` entry.

## 6. API & web app

- REST (Spring Boot), all `userId`-scoped: workouts (list/get/create/**edit (PUT, full replace)**/
  soft-delete + granular set PATCH by `(workoutId, setId)`); exercises (list/create, **PATCH equipment**,
  `last-working-set`); templates (CRUD); **splits (CRUD)**; `me` + bodyweight; **plan** (GET / POST /
  POST advance / POST mesocycle / DELETE / **GET /api/plan/history**). One-time import is a CLI.
- **Decimals as strings** on the wire; `last-working-set` is a deterministic aggregation (excludes
  warmups + soft-deleted). Typed **409** on exercise-name conflict returns the existing `exerciseId`.
- **Frontend** (React + Vite + TanStack Query): Training Log (`/previous-workouts`) with detail/edit,
  Start (`/start`) — empty or template, splits grouped & collapsible + inline template builder,
  Exercise List/detail (`/exercise-list`), `/past-plans` (plan history), settings sidebar. Logging
  engine shared by new + edit sessions; weights stay strings. App **data** is online-only (server is
  the source of truth); **settings** are now local-first (see §6a).
- **Plan completion flow:** `CompletionScreen` (shown once after a plan reaches COMPLETED, gated by
  `dismissedCompletionPlanId` settings slice); `PastPlans` page (`/past-plans`, reads
  `GET /api/plan/history`); `PlanSummaryCard` (shared card showing plan stats); `summarizePlan`
  (pure function in `src/planSummary.ts`).
- **`WeekCalendar` component** (`src/components/WeekCalendar.tsx`): editable Mon–Sun grid showing rest
  days and template-to-weekday assignments; tap-on-cell reassignment. During plan creation it is
  editable (`editable` prop + `onChange`); on the active plan page it is read-only (no `editable` prop,
  driven by the persisted `split.weekdays`).
- **Reliability layer:** `ErrorBoundary` wrapping the entire app; shared `QueryError` component used as
  the `if (q.isError) return …` branch on every query-gated page; in-progress workout draft persisted
  to the `LocalStore` seam (key `wl.draft.new`, debounced 500 ms) with Resume / Discard on re-entry
  and `beforeunload` warning; **large-jump weight warning** in the logging engine (`set-jump-warn`
  indicator) when an entered weight is an unusually large step from the seeded placeholder.
- **Onboarding:** `CoachCard` shows a "Log weight" CTA + Mifflin–St Jeor maintenance estimate during
  the `GATHERING_DATA` state (before the trend has enough data); a profile completion CTA appears if
  height/age/sex are missing.

### 6a. Local-first storage layer (settings slice shipped) — ✅ DECIDED

Product direction: the on-device store is the **base/free tier**; cross-device **cloud sync is a future
subscription feature** (only the `SYNC_ENABLED` seam exists — no billing logic). Engine = **SQLite
everywhere** (the one embedded DB first-class on mobile `expo-sqlite` + desktop `better-sqlite3` *and*
available in-browser via `@sqlite.org/sqlite-wasm` over the OPFS `opfs-sahpool` VFS), fronted by a portable
`LocalStore` interface (`frontend/src/local/`) so native impls swap in with no call-site changes.

- **Shipped:** **settings** (`settings.tsx`) back onto `LocalStore` (SQLite-WASM, localStorage fallback);
  async hydrate + one-time legacy-localStorage migration + write-through + last-write-wins sync to
  `GET/PUT /api/me/settings` (tenant-scoped; `User.settings` map + epoch-ms `settingsUpdatedAt`).
- **Next phase (not built):** extend the same `LocalStore` pattern to the full data model — the real
  offline-first re-architecture, which uses the §8 sync hooks (`updatedAt`/`deletedAt` tombstones/`version`)
  with a delta-read + outbox, and warrants a council review.

### 6b. Authentication — verified sign-up + JWT revocation (council-ratified, audit-hardened) — ✅ shipped

Sign-up is **two steps, email-verified** (the atomic `POST /api/auth/register` is gone — it leaked email
enumeration and skipped verification). Sequence in **`docs/DIAGRAMS.md` #16**; council decision in the
`auth-system-council-2026-07` memory. NOT medical data; secrets are env-only.

- **Flow.** `POST /api/auth/signup/request {email}` → if the email is free, mint a 6-digit code and email it;
  **always replies with an identical neutral 202** (no enumeration). `POST /api/auth/signup/verify {email, code,
  password, confirmPassword}` → the **only** place a `User` is created (no half-account ever persists), then seeds
  the 84-exercise catalog and returns a JWT. `AuthController` is thin; logic in `web/auth/AuthService`.
- **`authChallenges` collection** (one per `{email, purpose}`, unique + TTL indexed): the secret is stored only as
  `codeHash = SHA-256(code + AUTH_TOKEN_PEPPER)` — the **pepper** defends the low-entropy 10⁶ code space from
  offline precomputation off a DB dump (WARNs under prod if unset today, since the prod build ships the
  `NoOpEmailSender` and no code is ever delivered; restore the fail-fast when real email + sign-up goes live).
  15-min expiry,
  5-attempt lockout, single-use consume, per-email send cap. **Every mutation is a single atomic `findAndModify`**
  — never a read-modify-write `save()` (audit M3): the review council proved a concurrent-verify TOCTOU on a
  non-atomic counter bypasses the lockout, so the attempt claim (`$inc` gated on `attempts < max`) and the
  send-cap increment are atomic. Correctness (expiry/single-use/cap) is code-enforced; indexes are hygiene.
- **`EmailSender` seam** (`email/`): `LoggingEmailSender` (dev default, `@Profile("!prod")` so the code-logging
  stub can never be the prod binding), `FileEmailSender` (E2E outbox, `email.sender=file`), `CapturingEmailSender`
  (test bean), and `NoOpEmailSender` (`@Profile("prod")` — logs a WARN, drops the message, never logs the code;
  it exists so prod still BOOTS, since with no `EmailSender` bean the context fails to start — that broke the
  Railway deploy). **Real provider wiring is a documented follow-up** — flows are built + testable, delivery
  stubbed, and prod verified-sign-up cannot deliver codes until a real provider replaces the NoOp.
- **JWT revocation via `tokenVersion`** (additive `int` on `User`, default 0, embedded as the `tv` claim).
  `JwtAuthenticationFilter` re-checks `tv` against the user's current `tokenVersion` on every authed request (one
  indexed `_id` projection lookup — NOT in the hot `Tenant.userId()` path), rejecting stale tokens and wiped users.
  `JwtService.issue(userId, tv, expiryMins)` supports variable lifetimes (the remember-me plumbing). Login runs
  **constant-time BCrypt** (a dummy hash when the email is unknown) so it isn't a timing enumeration oracle.
- **Deferred follow-up slices** (priority order): (5) password reset / "Retake ownership" (link-based; needs the
  App.tsx unauthenticated route for the link landing), (6) remember-me (30d/24h expiry split + localStorage/session),
  (7) account wipe (hard-delete, LAST — bumps `tokenVersion`; ship only with its full `WipeIntegrationTest`).
  Guards: `AUTH-1..11` in `ApiIntegrationTest` + `AuthCodesTest` + `JwtServiceTest`.

## 7. Coaching engine — periodization + prescription + energy (Layers 4–5)

Added after v5. Authoritative spec: **`docs/coach.md`**; behaviour in **`docs/DIAGRAMS.md`** (class diagram #12,
sequence diagrams #13–16). A research-backed coach, built as **pure frontend functions** (so the eval can sweep
them) over thin additive backend persistence — no breaking schema change.

- **Plan model (collection `plans`):** `Macrocycle` (one ACTIVE per user, cursor `mesoIndex`/`week`, `goal`,
  `targetDate`, `focusMuscles`, **`splitId`** — the split used for this plan's schedule, nullable)
  embeds `Mesocycle[]` (`blockType`, `phase`, `accumulationWeeks`, focus, `IntensityBand`).
  **Status lifecycle:** `ACTIVE → COMPLETED` (advance past the last mesocycle — sets `completedAt`);
  `ACTIVE → ENDED` (explicit DELETE or when a new POST replaces it — sets `endedAt`). COMPLETED and
  ENDED are both terminal; the distinction matters for history display — ENDED plans were abandoned mid-run.
  `PlanRepository.create()` marks any existing ACTIVE plan ENDED (not COMPLETED) before inserting the
  new one. `endActive()` sets ENDED + `endedAt`.
  **New endpoint:** `GET /api/plan/history` → all COMPLETED + ENDED plans for the tenant, sorted
  newest-first by `startedAt`.
  **Existing endpoints:** GET · POST · POST /advance · POST /mesocycle · DELETE.
  Additive fields on existing docs: `Workout.soreMuscles`, `Workout.cyclePhase` (DELOAD excluded from trends),
  `TemplateExercise.{reps,targetRir}`, `Exercise.{laterality,mechanic,loadable}`, `BodyweightEntry.id`,
  `Split.weekdays` (weekday per template slot — persists the `WeekCalendar` schedule the user edits, mirroring
  `PlanPreview.schedule`).
- **The pure-function engine** — planner (`frontend/src/periodization.ts`), prescription
  (`frontend/src/prescription.ts`), energy coach (`backend/coach/EnergyService.java`), the default catalog
  (`DefaultExerciseSeeder`, 84 exercises), and the `R##` eval catalog — is **specified in `docs/coach.md`**, the
  authoritative source, and is not restated here to avoid drift. (This section previously carried a copy that went
  stale on the rule count — the split is what prevents that.) The engine is pure so `npm run eval` sweeps it;
  persistence is the additive `plans` / `Split` / `Workout` fields listed above.

## 8. Deferred / operational (noted, not built now)

- **Mobile sync hooks already in place:** `updatedAt`, `deletedAt` tombstones, `version`, `loggedAt`
  live-vs-import, `schemaVersion`, stable per-set `setId`. Additive later — a `GET /workouts?updatedSince=`
  delta-read that *returns* tombstones + a tombstone-retention window makes sync a non-migration.
- **Open operational items** for the build phase: backup/PITR cadence; GDPR hard-delete vs tombstone
  retention (rawImport embeds original-row PII); offline auth/token-refresh lifecycle; `startedAt`
  timezone policy (store UTC instant + original offset; importer assumes a fixed import tz).
