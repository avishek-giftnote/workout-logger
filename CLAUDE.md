# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Workout Logger is a strength-training log: a **Java/Spring Boot + MongoDB backend** (`backend/`) and a
**React/Vite/TypeScript frontend** (`frontend/`). It was bootstrapped from a real Strong-app CSV export.
**`DESIGN.md` is the authoritative architecture record — read it before non-trivial changes.**

## Commands

### Backend (`cd backend`, Java 21 + Maven; set `JAVA_HOME` to a JDK 21)
- `mvn test` — compile + unit tests. Needs **no** database (the MongoDB integration test is skipped).
- `RUN_MONGO_TESTS=1 mvn test` — also runs `ApiIntegrationTest` (needs MongoDB on `localhost:27017`).
- Single test: `mvn test -Dtest=StrongParsersTest` or a method: `-Dtest=StrongImporterTest#importsRealExportWithExactCounts`.
- `mvn spring-boot:run` — REST API on `:8080` (needs MongoDB). OpenAPI at `/v3/api-docs`, Swagger UI at `/swagger-ui.html`.
- One-time Strong importer (Spring profile `import`, runs as a non-web CLI then exits):
  - Dry run (parse + assert, **no DB**): `mvn spring-boot:run -Dspring-boot.run.profiles=import`
  - Persist: add `-Dspring-boot.run.arguments="--importer.persist=true"` and set `IMPORT_USER_PASSWORD`.
- Env vars: `MONGODB_URI` (default `mongodb://localhost:27017/workoutlogger`), `SECURITY_JWT_SECRET`
  (blank ⇒ an **ephemeral** key is generated, so tokens reset on restart — set it for stable auth),
  `IMPORT_USER_EMAIL` / `IMPORT_USER_PASSWORD`, `IMPORT_CSV`, `IMPORT_BODYWEIGHT`.

### Frontend (`cd frontend`, Node)
- `npm install`, then `npm run dev` (`:5173`, dev-proxies `/api` → `:8080`).
- `npm run build` (`tsc && vite build`) and `npm run typecheck` — **`tsc --noEmit` (strict) is the only lint gate; there is no ESLint.**
- API types in `src/api/types.ts` are hand-written to match the backend DTOs; regenerate from the live
  contract with `npx openapi-typescript http://localhost:8080/v3/api-docs -o src/api/schema.ts` when they drift.

There is no MongoDB in this dev image by default; `brew` can't build `mongodb-community` here (Command Line
Tools too old). Use MongoDB Atlas (set `MONGODB_URI`) or the official precompiled binary.

## Architecture (big picture)

### Data model — MongoDB, session-as-document
A **workout session is one document** (`workouts`) that **embeds `exercises[]`, each embedding `sets[]`**.
Other collections: `users`, `exercises` (per-user catalog, keyed by raw name), `templates`, `splits`.
Entity relationships are many-to-many by id reference, not joins:
- `exercise` (catalog) → in 0+ templates · `template` (1+ exercises, each with a **set count**) → in 0+ splits ·
  `split` holds 0+ `templateIds` · a `workout` optionally links a `templateId` and embeds its blocks/sets.

### Backend invariants (do not regress — most caused real bugs this session)
- **Tenant isolation is the entire security story** (MongoDB has no RLS). Every repository in `repo/`
  reads `security/Tenant` (the JWT-principal `userId`) and ANDs `userId` into *every* find/update/delete.
  Controllers never accept a `userId`. `ApiIntegrationTest` proves user B gets 404 on user A's data.
- **Weights are exact decimals: `Decimal128` in Mongo, serialized as STRINGS on the wire.** `MongoConfig`
  registers `BigDecimal`↔`Decimal128` converters; DTOs carry weight/`loadDelta` as `String`. Never let a
  weight become a JSON number (a JS-`number` client silently rounds the ~25% fractional-kg values).
- **Embedded set id field is named `setId`, not `id`** — Spring Data maps any embedded field named `id` to
  `_id`, which made `arrayFilters` updates silently match nothing. Granular set updates address `(workoutId, setId)`.
- **Exercises partial-unique index filters on `{nameKey: {$exists: true}}`** — MongoDB rejects `$exists:false`
  in `partialFilterExpression`. See `MongoSchemaInitializer` (it also holds the `$jsonSchema` validators;
  it runs only in the `import` profile, since `auto-index-creation` is off).
- **Bodyweight model:** `sets.weight` = cumulative effective load; `loadMode`
  (`BODYWEIGHT`/`ADDED`/`ASSISTED`) + `loadDelta` preserve the decomposition; `equipment == BODYWEIGHT` ⟺
  `isBodyweight`. Effective load is recomputed from the user's *current* bodyweight.

### The Strong importer (`importer/`)
`StrongImporter` is a **pure, deterministic transform** of the CSV, proven by `StrongImporterTest` and the
runnable reference `tools/verify_import.py`. `ImportRunner` (profile `import`) asserts exact counts
(**1,533 sets / 47 sessions / 30 exercises / 195 warmups / 61 bodyweight rows**) and fails loud on drift.
Import is a **one-time bootstrap** that loads into a real, loginable account. Gotchas handled in
`StrongParsers` (regressing any of these breaks the import): Strong dates contain **U+202F** (a narrow
no-break space) before AM/PM and must be normalized first; durations have 4 shapes; `Set Order` mixes `1..N`
with `W` (split into `orderIndex` + `setType`); equipment is parsed from the name suffix.

### Frontend structure
- `src/logging/engine.tsx` is the **shared set-logging engine** (`DraftSet`/`DraftBlock`, `ExerciseBlockEditor`,
  `ExercisePicker`, `toCreateSet`, `seededSet` vs `filledSet`, the equipment list). Both `LogWorkoutPage`
  (new session, placeholders seeded from "last time") and `EditWorkoutPage` (existing workout, values filled)
  reuse it — **logging-UX changes belong here**, not duplicated in pages.
- `src/api/client.ts` is the typed fetch wrapper (JWT from `localStorage`, throws `ApiError`, clears token on 401).
- **Server state is TanStack Query**; query keys are stable strings (`["workouts"]`, `["exercises"]`,
  `["templates"]`, `["splits"]`, `["me"]`, `["workout", id]`) and mutations invalidate them. App is online-only.
- `App.tsx` defines routes (`/previous-workouts` is home, `/start`, `/exercise-list`, detail/edit sub-routes).
  `auth/auth.tsx` validates the token via `/api/me` on load and signs out if it's stale.
- `src/settings.tsx` is a localStorage-backed settings context; `prevSource` (`"any"` vs `"template"`) controls
  where logging placeholders are sourced from.
- **Decimals stay strings end-to-end** in the client too; parse to `number` only for transient display math.

## Conventions
- **Backend**: package `com.workoutlogger`; Java records for immutable value objects + embedded documents,
  classes for `@Document` aggregate roots; enums are `UPPER_SNAKE`. Keep controllers thin; logic lives in
  `repo/` and `importer/`.
- **Frontend**: function components; one hand-written design system in `styles.css` (dark "Iron Instrument"
  theme, `--volt` accent, fonts Bricolage Grotesque / Archivo / Spline Sans Mono) — **class-based styling, no
  CSS framework**.
- **Operational workflow when iterating on the running demo**: frontend changes hot-reload (just refresh);
  **new/changed backend endpoints require a server restart**; a **data-shape change requires re-importing**
  (into a fresh DB name) — only then does the user need to sign in again.
- **Commits** end with the `Co-Authored-By` trailer; the author email is a GitHub noreply (history was
  scrubbed of company emails). Secrets are env-only (no committed JWT secret or import credentials);
  `strong_workouts.csv` and `tools/import_preview.json` are git-ignored (personal data).
