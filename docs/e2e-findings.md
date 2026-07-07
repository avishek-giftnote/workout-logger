# E2E findings — actual vs intended

Discrepancies flagged by the Playwright FE+BE suite (`frontend/e2e/`), recorded per the e2e-strategy
council (sibling to `docs/eval-findings.md`, same TODO-pinned lifecycle). A finding earns a row only after
failing on a second isolated re-run (anti-flake). `test.fixme` in a spec points at a row here by `F##`; the
row points back at the spec. `Status: OPEN` = live, unfixed; `TRIAGE` = observed, cause not yet confirmed
app-vs-spec.

| ID | Spec | Journey | Expected (cited source) | Actual (observed) | Severity | App vs spec | Status |
|----|------|---------|-------------------------|-------------------|----------|-------------|--------|
| F01 | `tenant-isolation.spec.ts` | User B opens a direct link to user A's (or any nonexistent) `/previous-workouts/:id` | A tenant-scoped miss should surface as a **"not found"** state — the doc genuinely isn't the user's. `WorkoutDetailPage.tsx:48` even has a `.empty` "Workout not found" branch for exactly this. | ~~Renders the generic `QueryError` because `getWorkout` didn't coerce a 404 to null; the "Workout not found" branch was dead code.~~ **FIXED:** `getWorkout` now coerces 404→null (mirrors `lastWorkingSet`/`getPlan`), so the detail page's not-found branch renders; `EditWorkoutPage` gained the same branch (a coerced-null 404 would otherwise leave `blocks` null and spin forever). Guarded by 2 live e2e tests + the cross-tenant assertion (all now expect "Workout not found"). | MINOR | App (UX/error-contract) | FIXED |

## Resolved during the run (not findings)

- **bodyweight ADDED-mode effective load** — was a SPEC bug, now FIXED: on a bodyweight set-row the
  `.cell-input` order is delta=nth(0), reps=nth(1), rpe=nth(2) (`engine.tsx`); the spec filled delta via
  `.last()` and hit rpe, so `loadMode` fell to `BODYWEIGHT` and the decomposition was `"72.25 kg · BW"`.
  Fixed to `nth(0)`; the test passes and confirms `"74.75 kg · BW +2.5"` is reload-stable. Not an app defect.

## Deferred (documented `test.fixme`, honestly scoped, no app bug masked)

- **coach READY flip** (`coach-gate.spec.ts`): needs >=6 backdated weigh-ins over >14 days; seeding driver
  is complex/flake-prone. Underlying source is unbuggy (`CoachCard` ready branch exists).
- **plan COMPLETED walk** (`plan-lifecycle.spec.ts`): the shortest route (contest-prep near-date, 2 advances)
  needs live confirmation of the focus-muscle + date builder selectors. The ENDED state-machine walk IS tested.

## Known limitation (environment, NOT a defect)

The workout-logging specs (anything through `logSet` → the `/start` "Empty session" gate) are **flaky against
remote MongoDB Atlas**: RTT is ~600ms/op, so `/start`'s templates/splits queries compound past the gate
timeout under load (verified: no backend 500s, backend healthy throughout — pure latency). `retries: 1`
absorbs it and the suite is green. It is **reliable on a local mongo / CI's `mongo:7` service** (sub-ms). For
fast local runs point `MONGODB_URI` at a local mongo instead of Atlas.

## Suite status (2026-07-02)

**Full e2e suite: 14 passed / 3 fixme / 0 failed** (2 needed a retry against Atlas). New specs added this run,
all FE+BE against the real jar + isolated Atlas: `tenant-isolation`, `bodyweight-decimal` (3 cases incl. the
primary-entity workout-set decimal round-trip), `exercise-catalog`, `plan-lifecycle` (ENDED path),
`coach-gate` (GATHERING gate), `workout-delete`, `empty-and-error-states`. Pre-existing `critical-paths` /
`plan-slots` / `plan-slots-mocked` still green (no regression from the `helpers.ts` changes).
