# QA findings — hosted app sweep (2026-07-15)

Full adversarial UI/UX QA pass of the live production app, driven by the `qa-run` skill
(ui-bug-finder) adapted to this project. Target: **https://workout-logger.up.railway.app**
(prod, `workoutlogger_prod`). Playwright MCP, single throwaway account battery + a second
account for tenant checks. Every finding below was reproduced before logging; refuted
hypotheses are noted as such.

**Harness caveat (not app bugs):** the test browser's origin allowlist blocked
`fonts.googleapis.com` and `sentry.io`, so every page shows 1 blocked-font + N blocked-Sentry
console errors (`ERR_BLOCKED_BY_CLIENT`). These are my-side artifacts and are excluded from all
findings. No other console errors appeared on any page.

## Findings (most severe first)

### QA-01 — Wrong method / bad media type on a mapped route returns 500, not 4xx (+ Sentry noise) · MODERATE · ✅ FIXED 2026-07-16
**Fixed via `/autopilot`** (guard-first, review-council-overseen). `ApiExceptionHandler` now maps
`HttpRequestMethodNotSupportedException` → **405** (with an RFC-7231 `Allow` header),
`HttpMediaTypeNotSupportedException` → **415**, and `HttpMediaTypeNotAcceptableException` → **406**
(forced JSON body) — each returns before the Sentry-reporting `generic()` catch-all. The review council
surfaced a **fourth, insidious variant the original sweep missed**: an unsatisfiable `Accept` header
(e.g. `Accept: application/xml`) *already* returned 406 to the client — but `generic()` had still run and
fired a Sentry event underneath, because the 500 body couldn't be written as XML and re-negotiation
surfaced the 406, masking the capture. A status assertion alone was a false green; a dispatch-level
Sentry-capture-count guard (`ApiIntegrationTest.clientErrorsFireNoSentryEventAtDispatch`) caught it and
now pins zero captures for all four 4xx paths. Guards: 3 unit cases in `ApiExceptionHandlerSentryTest`
(405+Allow / 415 / 406+JSON, all zero-capture) + 2 `ApiIntegrationTest` cases (status + dispatch-capture).
Backend gate green (`ApiIntegrationTest` 83, `ApiExceptionHandlerSentryTest` 6). Not yet committed.

_Original finding:_ **Verified across 5 routes.** Any request with an unmapped method on an *existing* `/api` path
returns `500 {"message":"Internal error"}` instead of `405 Method Not Allowed`:

| Request | Got | Expected |
|---|---|---|
| `DELETE /api/workouts` | 500 | 405 |
| `PUT /api/workouts` | 500 | 405 |
| `DELETE /api/me/settings` | 500 | 405 |
| `POST /api/me` | 500 | 405 |
| `DELETE /api/exercises` / `DELETE /api/exercises/{id}` | 500 | 405 |
| `DELETE /api/me` | 500 | 405 |

Genuinely unmapped paths (`/api/account`, `/api/users/me`) correctly 404, which isolates this to
`HttpRequestMethodNotSupportedException` falling through to the generic `Exception` catch-all in
`ApiExceptionHandler`. Same class as the shipped #40 (missing-static → 404) and #44 (unknown
`/api` → 404) fixes, for method-mismatch instead of not-found.

**Why it matters:** each 500 is captured by backend Sentry, so routine method-mismatches (scanners,
mis-coded clients, a client calling the wrong verb) will flood Sentry with false "Internal error"
events — the exact noise #40 was meant to stop.

**Fix:** add `@ExceptionHandler(HttpRequestMethodNotSupportedException.class)` → 405 in
`ApiExceptionHandler` (guard-first: a test asserting `DELETE /api/workouts` → 405). Consider also
`HttpMediaTypeNotSupportedException` → 415 in the same pass.

### QA-02 — Core logging inputs lack programmatic labels · MINOR–MODERATE (a11y)
The set-row inputs (weight / reps / RPE) have `placeholder="—"` and **no** `aria-label` or
associated `<label>`; the visible "kg / reps / rpe" captions are sibling text, not linked. A
screen-reader user on the primary logging flow hears "edit text" with value "dash". Same pattern
on the Plan builder's muscle-slot comboboxes ("Chest", "Lats"…) and the Settings profile fields.
**Positives:** touch targets are ≥34px (above the 24px min) and `inputmode` is correct
(`decimal` for kg, `numeric` for reps/rpe → right mobile keypad).
**Fix:** add `aria-label` (or `<label for>`) to each set input and combobox.

### QA-03 — Backend validation error is developer-facing + no client-side bound · MINOR
Entering weight `999999.99` and finishing surfaces the raw message
`exercises[0].sets[0].weight weight must be a decimal ≤ 9999` — it leaks the internal field path
and duplicates the word "weight". **Good:** the session is preserved (no data loss) and the
backend rejects it atomically (no partial write — verified the workout list count was unchanged).
Two sub-issues: (a) humanize the message ("Weight must be 9999 kg or less"); (b) there is no
client-side max, so the field accepts absurd values and only fails at save time.

### QA-04 — Pervasive singular/plural bug ("1 exercises · 1 sets") · MINOR (cosmetic)
Counts are never singularized. Seen on: the save toast ("Reuse this lineup (1 exercises)"), the
workout list card ("1 exercises · 1 sets"), the workout detail header, the Volume page
("1 sets · below MEV"), and the "Last time: … · 1 sets" hint. One pluralization helper would fix
all sites.

### QA-05 — In-session "Discard" has no confirmation, even with a completed set · MINOR
Clicking **Discard** on the live Log Session view jumps straight to the training log with no
confirm, discarding a ticked/filled set (reproduced with a completed set present). Contrast with
the reload path, which *does* protect the draft (beforeunload guard + Resume/Discard prompt — see
QA-07 positives). A two-step confirm on Discard when the session has any logged set would close the
accidental-loss gap.

### QA-06 — Icon-only buttons named only by their glyph · MINOR (a11y)
`✓`, `×`, `⚙` expose no `aria-label`; the accessible name is the glyph ("check mark",
"multiplication sign", "gear"). Descriptive labels ("Complete set", "Remove exercise", "Settings")
would help AT users. Low severity — glyphs do produce *a* name.

## Verified holding (no defect — the important positives)

- **Decimal128-as-string end to end.** Logged `60.5`, edited to `72.25`, bodyweight `72.5` — all
  serialize as JSON **strings** on the wire and store as Mongo `Decimal128`
  (`{"$numberDecimal":"72.5"}`), derived at read. No float drift anywhere.
- **Tenant isolation.** Account B GET/DELETE of account A's workout → **404**; B's own list empty.
  No cross-tenant read or mutation.
- **Auth enforcement.** No token / garbage token / forged-signature token → **401** on `/api/workouts`.
- **XSS refuted.** A custom exercise named `<img src=x onerror=…>` renders as literal text
  (React auto-escaping); `onerror` never fired, no `<img>` injected.
- **Network-failure resilience (excellent).** A failed save POST shows a user-friendly
  "Network error — check your connection and try again.", preserves the full draft in place, and
  the retry succeeds once connectivity returns. Silent data loss did not occur.
- **Durable draft across reload.** Reloading mid-session fires the `beforeunload` guard, and on
  return offers "In-progress workout found … Resume / Discard"; Resume restored the set exactly.
- **F01 fixed in prod.** Deep-linking a nonexistent/other-tenant workout shows "Workout not found",
  not the generic error.
- **Backend validation atomic.** The over-range-weight save rejected without persisting a partial workout.
- **Coaching engine renders correctly.** Plan builder (5-block macrocycle, rest days spaced ≥48h,
  ≥2×/week frequency, muscle-slot comboboxes), Volume vs MEV/MAV/MRV landmarks with synergist
  credit, and the energy-balance data-sufficiency gate ("Gathering data 0/6 weigh-ins").
- **A11y basics.** `<html lang="en">`, sensible heading order, images have alt, weekly-schedule
  buttons carry descriptive names ("Mon: Upper A — tap to pick").

## Not tested / limitations

- **Plan "Accept & start", template save, workout Delete via UI** — not exercised, to limit prod
  writes (covered by existing e2e + prod verification).
- **Sentry ingest from my session** — unverifiable (my browser blocks sentry.io); already verified
  live in prod earlier (2026-07-09).
- **Contrast / visual polish** — custom fonts were blocked in my browser, so I did not judge
  rendered typography/contrast.
- **Cleanup complete (2026-07-16).** Purged via a temporarily-writable Mongo MCP: 2 test accounts,
  169 exercises (84 seeded defaults ×2 + the XSS-payload row), 2 workouts, embedded bodyweight — all
  verified count=0 in `workoutlogger_prod`. (There is still no delete-account/delete-exercise endpoint —
  they 500 under QA-01's now-fixed generic handler — so this required a direct DB write.) MCP flipped
  back to read-only after.
