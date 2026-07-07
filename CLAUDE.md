# CLAUDE.md

*Tier 3 — project memory for workout-logger. Loads on top of Tier 2 (workspace `~/AvisheksIntelligence/CLAUDE.md`) + Tier 1 (global `.claude/CLAUDE.md`) when working inside this project. Scope: this project only.*

Workout Logger is a strength-training log: a **Java/Spring Boot + MongoDB backend** (`backend/`) and a
**React/Vite/TypeScript frontend** (`frontend/`). It was bootstrapped from a real Strong-app CSV export.
**`DESIGN.md` is the authoritative architecture record — read it before non-trivial changes.**

## Workflow rules (read me first)

- **Run independent tasks in parallel** (Agent tool) — delegation / clean-context rules live in global memory.
- **Decision → executable guard, same change.** The moment a design decision or council states an invariant (Decimal128-as-string, every prime mover ≥2×/week, data-sufficiency gates…), encode it as a *failing test first*, then implement. Every bug this codebase hit was a known hazard that recurred until a test pinned it.
- **Plan before multi-file features.** Use plan mode for anything spanning backend+frontend or several modules; get the plan approved before writing code.
- **Verify UI changes in the running app** before reporting them done — don't claim a layout/CSS fix you haven't watched render.
- **Slash commands for the rituals:** `/gate` (full pre-commit checks), `/council` (convene the specialists in `.claude/agents/`), `/import` (rebuild the dev DB). A `git commit` by Claude also triggers the frontend pre-commit gate via `.claude/hooks/pre-commit-gate.sh`.

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
- `npm run build` (`tsc && vite build`) and `npm run typecheck` — **`tsc --noEmit` (strict) is the lint gate; there is no ESLint.**
- `npm test` — Vitest unit tests for pure functions (`src/**/*.test.ts`: logging engine, periodization).
- `npm run e2e` — **Playwright** critical-path E2E (`e2e/*.spec.ts`): register → log a workout → persist →
  edit, settings persistence, the login error message, etc. By default it boots the prod bundle (`vite
  preview` :4173) + the packaged backend jar (:8080) and needs a Mongo (set `MONGODB_URI`). For fast local
  iteration against an already-running stack: `E2E_BASE_URL=http://localhost:5173 npm run e2e`.
- API types in `src/api/types.ts` are hand-written to match the backend DTOs; regenerate from the live
  contract with `npx openapi-typescript http://localhost:8080/v3/api-docs -o src/api/schema.ts` when they drift.

**CI release gate** (`.github/workflows/ci.yml`, runs on every push/PR, no secrets — Mongo is a `mongo:7`
service container): three jobs — **frontend-gate** (typecheck · unit · eval · build), **backend-gate**
(`RUN_MONGO_TESTS=1 mvn test` — tenant isolation + the contract + plan/settings round-trips), and **e2e**
(Playwright over the critical journeys against the built bundle + packaged jar). This is the Tier-1 prod
gate; load/k6, observability, secrets rotation, Atlas backups, and a security review are separate
prod-readiness items, not yet built.

There is no MongoDB in this dev image by default; `brew` can't build `mongodb-community` here (Command Line
Tools too old). Use MongoDB Atlas (set `MONGODB_URI`) or the official precompiled binary.

## Testing & verification (do this for EVERY functional change)

**Always add/extend tests for what you change, then run the suites — never commit on a manual smoke test
alone.** A change is "done" only when new behaviour is covered, edge cases are probed, and previously-passing
tests still pass.

1. **Cover three things, not one:** the happy path; **edge cases** (empty/insufficient data and the gates that
   guard it, boundary values, nulls on pre-existing docs, same-day/zero-span, unrecognised input); and
   **regression** — re-run the suites for any feature your change touches.
2. **Where tests go.** Backend: pure logic → a plain JUnit test that runs in `mvn test` (e.g. `MuscleSeedTest`,
   `EnergyServiceTest`, `StrongParsersTest`); anything hitting an endpoint/Mongo → add to `ApiIntegrationTest`
   (gated by `RUN_MONGO_TESTS=1`). Frontend: pure functions → a `*.test.ts` Vitest beside the source
   (`engine.test.ts`, `periodization.test.ts`). Prefer extracting logic into pure functions so it's testable.
3. **The pre-commit gate.** Frontend: `npx tsc --noEmit` + `npm test` + `npm run build`. Backend: `mvn test`,
   and **`RUN_MONGO_TESTS=1 mvn test` whenever you touched an endpoint, DTO, repo, or domain**. Plus a curl
   smoke test of new/changed endpoints against the running server (matches the live wire shape).
4. **Project-specific things to always assert:** tenant isolation (user B gets 404 / empty on A's data);
   decimals-as-strings on the wire (no float drift); additive/nullable fields don't break existing docs;
   data-sufficiency gates return the "gathering"/insufficient state below threshold. These are the bugs that
   have actually bitten this codebase (see DESIGN.md / the invariants below).
5. **Complex or cross-cutting features:** after building, consider convening the **council** (a `Workflow` over
   the specialists in `.claude/agents/`, see `.claude/agents/README.md`) to review the system end-to-end for
   correctness, missed edge cases, and regressions — the same way the cardio / energy-balance / progression
   designs were vetted. Worth it when a change spans backend+frontend+data model or has safety implications.

Current suite size (keep roughly current when you add tests): **backend ~62** (`mvn test` runs ~37 pure
classes — incl. `EnergyServiceTest`'s dead-band/PAL boundary cases; `RUN_MONGO_TESTS=1` adds the 35-test
`ApiIntegrationTest`, incl. the plan state-machine + history + completion), **frontend 116** (`npm test`)
**+ 3 eval sweeps** (`npm run eval`: coach planner R1–R40, prescription engine incl. block-transition guard,
logging path). Playwright E2E (`npm run e2e`, `frontend/e2e/`) — 3 spec files, 6 test cases: critical paths
(register/login/log+edit/settings), plan-slots, plan-slots-mocked.

**Eval harness** (`cd frontend && npm run eval`, plus the backend boundary tests) — a council-ratified
invariant catalog, subdivided by domain. Each rule is numbered (`L##` logging, `R##` planner+prescription,
`E##` energy, `SM##` plan state-machine) and pinned as a failing-guard-first check:
- **`coach.eval.test.ts`** sweeps the macrocycle planner over every goal × days × duration × focus (240
  configs) — prime movers ≥2×/week (against BOTH the synthetic and the **real** default catalog), now
  **frequency-by-design** (R33: every prime mover/focus muscle scheduled ≥2× by construction, not just warned)
  and **slot integrity** (R34/R35: each muscle-group slot's default trains it, ≤2 slots/muscle/day, distinct
  defaults when the catalog allows), block potentiation (no STRENGTH/PEAK before HYPERTROPHY), volume stays
  within [MV, MRV] for all 15 muscles every week/phase, phase band-step monotone, CONTEST_PREP calendar never
  overshoots the show date (one terminal PEAK), and the measured-DEFICIT phase clamp. **R36–R40** add:
  recovery-ordering optimality (R36), rest-day scheduling / `scheduleWeek` ≥48h (R37), no redundant
  exercise on the real catalog (R38), intra-session spacing — no consecutive same-primary-muscle slots
  (R39), session-total cap ≤ `SESSION_TOTAL_CAP` (R40).
- **`prescription.eval.test.ts`** — RIR wave, double progression, readiness supersession, e1RM/rpePct
  monotonicity, `topWorkingSet` selection (never warmup/deload), `workingLoad` increment rounding, and a
  **block-transition guard (R37)**: rep-range change re-anchors load to e1RM, not double-progression.
- **`logging/logging.eval.test.ts`** — placeholder→entry→serialization: bodyweight `bw±delta` with **no
  Decimal float drift**, loadMode decomposition, placeholder coalescing, cardio km→m, `pickPrevSets`
  template scoping, finished-block/readiness-ease helpers.

Run after any change to `periodization.ts` / `prescription.ts` / `EnergyService` / the logging engine; it
catches silent rule violations the sampled unit tests miss, and is **separate** from `npm test`. Deferred
design decisions the council surfaced (clampPhase confidence, deload floor, MAINTENANCE slow-gain, e1RM
RPE-vs-Epley, energy t-multiplier) are tracked in **`docs/eval-findings.md`** — those evals pin current
behavior with a `TODO`; flip them when the decision is made.

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
  Same rule on the User doc: bodyweight entries use `entryId` (legacy rows backfilled at startup, never on read).
- **Concurrency mechanism is chosen by write shape — see DESIGN.md §2a.** `@Version`+If-Match/409 only where the
  client can act on a conflict; timestamp-LWW (always 200) for fire-and-forget sync writes; targeted atomic
  ops (`MeRepository`) for disjoint/key-addressed User subtrees. **Never read-modify-write `save()` a shared
  doc** (audit M3: it dropped concurrent writes); preconditions go inside the update's match; check
  `matchedCount`, not `modifiedCount`; `currentBodyweightKg` is derived at read (`BodyweightMath`), never written.
- **Exercises partial-unique index filters on `{nameKey: {$exists: true}}`** — MongoDB rejects `$exists:false`
  in `partialFilterExpression`. See `MongoSchemaInitializer` (it also holds the `$jsonSchema` validators;
  it runs only in the `import` profile, since `auto-index-creation` is off).
- **Bodyweight model:** `sets.weight` = cumulative effective load; `loadMode`
  (`BODYWEIGHT`/`ADDED`/`ASSISTED`) + `loadDelta` preserve the decomposition; `equipment == BODYWEIGHT` ⟺
  `isBodyweight`. Effective load is recomputed from the user's *current* bodyweight.
- **`CreateSetRequest` is Bean-Validated with cascade `@Valid`**: `@Pattern` on weight/loadDelta (decimal ≤9999), `@Min(0) @Max(1000)` on reps, `@Min(1) @Max(10)` on rpe. `CreateBlockRequest` carries `@NotNull @Valid List<CreateSetRequest>`, so bad input is rejected before it can poison e1RM. (`UpdateSetRequest` had this already; bulk-save path was the gap.)
- **Plan terminal states**: `Macrocycle.status` is `ACTIVE | COMPLETED | ENDED` with `completedAt`/`endedAt` (both nullable Instants) and `splitId` (the split used for the schedule). `Split` carries a `weekdays` list (weekday per template slot, 0=Mon…6=Sun; nullable on old docs). New endpoint `GET /api/plan/history` returns all COMPLETED and ENDED plans for the tenant, newest-first.

### The Strong importer (`importer/`)
`StrongImporter` is a **pure, deterministic transform** of the CSV, proven by `StrongImporterTest` and the
runnable reference `tools/verify_import.py`. `ImportRunner` (profile `import`) asserts exact counts
(**1,533 sets / 47 sessions / 30 exercises / 195 warmups / 61 bodyweight rows**) and fails loud on drift.
Import is a **one-time bootstrap** that loads into a real, loginable account. Gotchas handled in
`StrongParsers` (regressing any of these breaks the import): Strong dates contain **U+202F** (a narrow
no-break space) before AM/PM and must be normalized first; durations have 4 shapes; `Set Order` mixes `1..N`
with `W` (split into `orderIndex` + `setType`); equipment is parsed from the name suffix.

### The coaching engine (Layers 4–5) — `docs/coach.md` is the authoritative spec
A research-backed periodization + prescription system, mostly **pure frontend functions** (so they're swept by
the eval), with thin additive backend persistence. Read `docs/coach.md` before touching it.
- **`src/periodization.ts`** — the **macrocycle planner**. `planMacrocycle(goal, weeks, targetDate, focus,
  days, catalog, measuredPhase)` → an ordered `Mesocycle[]` (block types/phases per goal recipe, `clampPhase`
  by the Coach's measured energy phase) + a generated split. `targetSets` ramps every muscle MEV→ceiling at
  ~+2 sets/wk with a bounded **phase band-step** (`PHASE_MODIFIERS`, orthogonal to `blockType`); `generateSplit`
  **designs the microcycle for ≥2×/week** (any prime mover/focus muscle the base shape under-hits is added to the
  lightest days — frequency is guaranteed, not warned), then `daySlots` emits **user-selectable muscle-group
  slots** (a placeholder per ~3 sets, ≤2 exercises/muscle/day, pre-filled with a recommended default via the
  shared **`trainsMuscle`/`fracOf` ≥0.5 basis** in `muscles.ts`). `PlanPage` lets the user swap each slot from a
  per-muscle dropdown; on accept slots resolve to concrete exercises (same-exercise slots merge). `orderForRecovery`
  spaces a muscle + synergists ≥48–72h. `scheduleWeek` assigns training days among 7 weekday slots (rest days
  in between); the result populates `PlanPreview.schedule`. **Intra-session ordering**: `daySlots` consolidates
  distinct-stimulus duplicates and orders slots so no two consecutive slots share the primary muscle. A
  `SESSION_TOTAL_CAP` (20 working sets/session) caps each day; excess sets are redistributed or trimmed.
  Duration-truncation: the planner trims the last meso when the total would overshoot the target date.
- **`src/prescription.ts`** — the **living-plan engine** (pure, tested): `rpePct` (RTS table
  `100−2.5(reps−1)−5·RIR`), `e1rm`, `workingLoad`, `topWorkingSet`, `nextLoad`/`progressedSeed` (double
  progression; bodyweight progresses on reps), `rirWave` (3→0, phase-floored), `readiness` (eases a sore /
  under-recovered muscle from strictly-prior sessions). **Block-transition (cross-block load seed)**: when
  rep range changes between blocks, `progressedSeed` re-anchors load from `e1rm` instead of double-progressing,
  preventing unearned load bumps. `LogWorkoutPage` seeds the next session from these.
- **`coach/EnergyService.java`** — read-time, gated surplus/deficit estimate: Mifflin–St Jeor × PAL +
  least-squares weight slope with a 95% CI, a ±0.1%bw/wk dead-band (anchored to ȳ), CI-derived confidence.
  Feeds the planner's `measuredPhase` clamp. Persisted plan endpoints live in `PlanController` (collection
  `plans`, one ACTIVE macrocycle, `advance()` rolls week→deload→next meso).
- **Eval harness** (see above) — `coach.eval.test.ts` (planner R1–R40) + `prescription.eval.test.ts`
  (engine R10–R22 + R37 block-transition). **Every coaching invariant is pinned here**; add a new `R##` when you add a rule.
- **Default catalog**: `DefaultExerciseSeeder` seeds `resources/default-exercises.json` (84 exercises w/ muscle
  map, equipment, laterality, mechanic, loadable) into every new user at registration; `restore-defaults`
  back-fills missing ones for existing users. Exercise attributes are user-editable (`ExerciseDetailPage`).

### Diagrams
`docs/DIAGRAMS.md` (moved from repo root 2026-07-07, with `docs/DIAGRAMS.pdf`) holds the validated Mermaid set
(renders on GitHub) — structural (the **full domain class diagram** #12, now storage-typed: ObjectId /
Decimal128 / ISODate) + behavioural **sequence diagrams** (#13 log-a-planned-session, #14 build/accept-a-plan,
#15 energy estimate, #16 registration+seeding, #17 plan-completion) plus the earlier flow charts. **Keep it
current when the model changes** and validate (the repo has used a `mermaid.parse` node check; a `;` inside a
sequence message breaks the parser — use `·`).
- **ALWAYS regenerate `docs/DIAGRAMS.pdf` after editing `docs/DIAGRAMS.md`** (it's a committed artifact, not
  git-ignored, so a stale PDF ships otherwise). Run `tools/build-diagrams-pdf.mjs` (renders each Mermaid block
  in headless Chrome → A4 PDF). It needs `marked mermaid puppeteer-core` + a local Chrome — install the deps
  **into `tools/` (not repo-root `node_modules`, which is NOT git-ignored), build, then delete
  `tools/node_modules` + `tools/package*.json` before committing.** Commit `docs/DIAGRAMS.pdf` explicitly (don't
  `git add -A` while those temp deps exist):
  ```
  cd tools && npm init -y && npm install marked mermaid puppeteer-core && cd ..
  CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node tools/build-diagrams-pdf.mjs
  rm -rf tools/node_modules tools/package.json tools/package-lock.json
  ```
  (A `/diagrams` skill should wrap this validate-then-rebuild-then-clean loop.)

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
- `src/settings.tsx` is a **local-first** settings context; `prevSource` (`"any"` vs `"template"`) controls
  where logging placeholders are sourced from. It backs onto `src/local/LocalStore.ts` (the portability
  **seam**: `SqliteLocalStore` over SQLite-WASM/OPFS — `src/local/sqlite.ts` — with a `LocalStorageLocalStore`
  fallback), async-hydrates with a one-time legacy-localStorage migration, and syncs to the server
  (`GET/PUT /api/me/settings`, tenant-scoped, last-write-wins by epoch-ms `updatedAt` on `User.settings`).
  Cloud sync is the future **subscription** feature — the only seam is the `SYNC_ENABLED` flag (true in dev);
  the local SQLite base is always on. The same `LocalStore` interface is how desktop/mobile offline will be
  added (swap in `expo-sqlite`/`better-sqlite3`). See the memory note `local-first-storage`. Settings gained
  `dismissedCompletionPlanId` (tracks which plan the completion screen was already shown for, so it displays once).
- **New frontend components this session:**
  - `src/components/WeekCalendar.tsx` — editable weekly schedule grid; tap a cell to toggle a training day.
  - `src/components/ErrorBoundary.tsx` + `src/components/QueryError.tsx` — reliability layer; `isError` branches in query hooks fall back to these so the app degrades gracefully instead of crashing.
  - `src/pages/CompletionScreen.tsx` — shown once when the active plan is completed (`dismissedCompletionPlanId` prevents re-showing).
  - `src/pages/PastPlans.tsx` + `src/pages/PlanSummaryCard.tsx` — browse completed/ended plans via `GET /api/plan/history`; `planSummary.ts` (`summarizePlan`) computes the summary stats.
  - `LogWorkoutPage` **reliability additions**: draft persistence to `LocalStore` (survives a reload mid-session), `beforeunload` guard (browser warning on navigation away with unsaved work).
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
- **Secrets** are env-only (no committed JWT secret or import credentials);
  `strong_workouts.csv` and `tools/import_preview.json` are git-ignored (personal data).

## Streamlining: skills & sub-agents (recommendations)
Recurring rituals this project keeps doing by hand — worth a **skill** (slash command) or a **sub-agent** so
they're one step and consistent:
- **`/restart-smoke` skill** — the most-repeated loop: stop the running `spring-boot:run`, restart it on the
  demo3 DB with the fixed JWT secret (no re-login), wait for `:8080`, then curl-smoke the changed endpoints +
  clean up any junk demo rows. Done ~10× this session by hand.
- **`/gate` skill** (exists) — run it every commit: frontend `tsc + npm test + npm run eval + build`; backend
  `RUN_MONGO_TESTS=1 mvn test`. Extend it to also validate `docs/DIAGRAMS.md` mermaid when that file changed.
- **`/diagrams` skill** — regenerate/validate the Mermaid in `docs/DIAGRAMS.md` via the `mermaid.parse` node check
  (the repo re-implements this ad-hoc each time; the `;`-in-sequence-message trap should be auto-caught).
- **research sub-agents** — exercise-science / periodization research and broad codebase surveys should always
  be delegated (the `periodization-coach`, `sports-data-expert`, `Explore` agents) so raw pages/file-dumps stay
  out of the main context. This session proved it: the planner, prescription, and audit work all went through
  sub-agents and only conclusions returned.
- **the council `Workflow`** — for any cross-cutting design or end-to-end review, convene the `.claude/agents/`
  specialists (now incl. `periodization-coach`, `contest-prep-coach`, `energy-analyst`, `eval-engineer`).
  Reminder: workflow agents are **not** the `.claude/agents` types — embed each persona in the prompt
  (title + lens); do **not** pass `agentType` for them.
- **eval-author sub-agent** — when a decision/invariant is stated, an `eval-engineer` agent can draft the `R##`
  guard (the "decision → executable guard, same change" rule), keeping the sweep exhaustive.
