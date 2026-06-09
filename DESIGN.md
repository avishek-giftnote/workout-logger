# Workout Logger — Design (v4)

> Council synthesis over the real Strong CSV (`strong_workouts.csv`), revised by product-owner
> directives, then stress-tested by a second council against the v3 MongoDB model. Every empirical
> claim was verified against the raw file. **v4 folds in the council's refinements; §5 (bodyweight
> entry) awaits product-owner confirmation.**

## 0. Stack & directives (settled)

- **Backend:** Java + Spring Boot (Spring Data MongoDB, Spring Security/JWT).
- **Frontend:** React (Vite) + CSS SPA over a REST API; OpenAPI-generated TS client.
- **Database:** MongoDB. **Decimal128** for weights.
- **Importer:** one-off Java service. Import = **one-time bootstrap**; in-app edits win thereafter.
- **Scope:** 4 templates — Anterior/Posterior × Upper/Lower focus.
- **Exercise names:** raw string (no equipment parsing).
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
  isBodyweight, defaultUnit,
  schemaVersion, createdAt, updatedAt, deletedAt }

// templates  (the 4 scoped templates)
{ _id, userId, name, exercises: [ { exerciseId, position } ], schemaVersion, createdAt, updatedAt }

// workouts  (core collection)
{ _id, userId, version,                 // version = @Version optimistic lock
  startedAt, startedAtOffset, durationSeconds, rawDurationText, templateId,
  exercises: [
    { exerciseId, name, position, note,         // embedded name = immutable historical snapshot
      sets: [
        { id,                                   // stable per-set identity (addressable writes)
          orderIndex, setType,                  // setType: warmup|working|drop|failure
          weight: Decimal128,                   // canonical effective load
          loadMode, loadDelta,                  // see §5 (pending confirmation)
          weightUnit, reps, rpe, note,
          loggedAt, estimated,                  // estimated=true for backfilled bodyweight rows
          rawImport, importRowIndex } ] } ],
  schemaVersion, createdAt, updatedAt, deletedAt }
```
*Cardio (`distanceM`,`durationS`) omitted from the v3 write contract — 100% unused; add (purely
additively) when a cardio exercise first exists, so the TS client isn't bloated with untested fields.*

**Indexes:** `workouts {userId, startedAt:-1}`; `workouts {userId, 'exercises.exerciseId', startedAt:-1}`
(seeds last-working-set); `exercises {userId, nameKey}` **partial unique** `{deletedAt:{$exists:false}}`;
`workouts {userId, startedAt}` **unique** (import idempotency key, computed from normalized instant).

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

## 6. API & web data layer

- REST (Spring Boot), all `userId`-scoped: workouts / exercises / templates / bodyweight CRUD;
  one-time import endpoint.
- **Flat projected DTOs** for exercise-centric reads (never the whole session doc): `last-working-set`
  returns one set; a per-exercise set time-series feeds charts. Granular set write keyed by
  `(workoutId, setId)`.
- Typed **409** on exercise-name conflict (returns the existing `exerciseId`) so the React form
  resolves to the existing catalog entry instead of erroring.
- React + TanStack Query, optimistic updates, **online-only** this phase.

## 7. Deferred / operational (noted, not built now)

- **Mobile sync hooks already in place:** `updatedAt`, `deletedAt` tombstones, `version`, `loggedAt`
  live-vs-import, `schemaVersion`, stable per-set `id`. Additive later — a `GET /workouts?updatedSince=`
  delta-read that *returns* tombstones + a tombstone-retention window makes sync a non-migration.
- **Open operational items** for the build phase: backup/PITR cadence; GDPR hard-delete vs tombstone
  retention (rawImport embeds original-row PII); offline auth/token-refresh lifecycle; `startedAt`
  timezone policy (store UTC instant + original offset; importer assumes a fixed import tz).
