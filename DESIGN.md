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
{ _id, userId, name, templateIds: [ ... ], schemaVersion, createdAt, updatedAt }

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

## 3. The 6 high-impact council fixes (adopted)

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
  `last-working-set`); templates (CRUD); **splits (CRUD)**; `me` + bodyweight. One-time import is a CLI.
- **Decimals as strings** on the wire; `last-working-set` is a deterministic aggregation (excludes
  warmups + soft-deleted). Typed **409** on exercise-name conflict returns the existing `exerciseId`.
- **Frontend** (React + Vite + TanStack Query): Training Log (`/previous-workouts`) with detail/edit,
  Start (`/start`) — empty or template, splits grouped & collapsible + inline template builder,
  Exercise List/detail (`/exercise-list`), settings sidebar. Logging engine shared by new + edit
  sessions; weights stay strings. App **data** is online-only (server is the source of truth); **settings**
  are now local-first (see §6a).

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

## 7. Coaching engine — periodization + prescription + energy (Layers 4–5)

Added after v5. Authoritative spec: **`docs/coach.md`**; behaviour in **`DIAGRAMS.md`** (class diagram #12,
sequence diagrams #13–16). A research-backed coach, built as **pure frontend functions** (so the eval can sweep
them) over thin additive backend persistence — no breaking schema change.

- **Plan model (collection `plans`):** `Macrocycle` (one ACTIVE per user, cursor `mesoIndex`/`week`, `goal`,
  `targetDate`, `focusMuscles`) embeds `Mesocycle[]` (`blockType`, `phase`, `accumulationWeeks`, focus,
  `IntensityBand`). `PlanController` (`/api/plan` GET/POST/advance/mesocycle/DELETE). Additive fields on
  existing docs: `Workout.soreMuscles`, `Workout.cyclePhase` (DELOAD excluded from trends),
  `TemplateExercise.{reps,targetRir}`, `Exercise.{laterality,mechanic,loadable}`, `BodyweightEntry.id`.
- **Planner — `frontend/src/periodization.ts`:** `planMacrocycle(goal, weeks, targetDate, focus, days,
  catalog, measuredPhase)` → ordered blocks (goal recipe, `clampPhase` by the Coach's measured energy phase) +
  a generated split. `targetSets` = MEV→ceiling ramp ~+2 sets/wk + a bounded **phase band-step** (`PHASE_MODIFIERS`,
  orthogonal to `blockType`). `generateSplit` selects exercises by the shared **`trainsMuscle` ≥0.5 basis**,
  keeps every prime mover ≥2×/week, and `orderForRecovery` spaces a muscle + synergists ≥48–72 h.
- **Prescription — `frontend/src/prescription.ts`:** `rpePct` (RTS `100−2.5(reps−1)−5·RIR`), `e1rm`,
  `nextLoad`/`progressedSeed` (double progression; bodyweight on reps), `rirWave` (3→0), `readiness`
  (eases a sore/under-recovered muscle, strictly-prior). `LogWorkoutPage` seeds the next session live.
- **Energy Coach — `backend/coach/EnergyService.java`:** Mifflin–St Jeor × PAL + least-squares slope/CI,
  ≥6 weigh-ins / ≥14–21 d gate, ±0.1%bw/wk dead-band (anchored to ȳ), CI-derived confidence; feeds
  `measuredPhase`.
- **Catalog:** `DefaultExerciseSeeder` seeds 84 exercises (muscle map + equipment + laterality + mechanic +
  loadable) into every new user; `restore-defaults` back-fills existing users.
- **Eval harness (`npm run eval`):** `coach.eval.test.ts` (planner R1–R18) + `prescription.eval.test.ts`
  (engine R10–R22) — every coaching invariant is pinned as an `R##` guard, separate from the `npm test` gate.

## 8. Deferred / operational (noted, not built now)

- **Mobile sync hooks already in place:** `updatedAt`, `deletedAt` tombstones, `version`, `loggedAt`
  live-vs-import, `schemaVersion`, stable per-set `setId`. Additive later — a `GET /workouts?updatedSince=`
  delta-read that *returns* tombstones + a tombstone-retention window makes sync a non-migration.
- **Open operational items** for the build phase: backup/PITR cadence; GDPR hard-delete vs tombstone
  retention (rawImport embeds original-row PII); offline auth/token-refresh lifecycle; `startedAt`
  timezone policy (store UTC instant + original offset; importer assumes a fixed import tz).
