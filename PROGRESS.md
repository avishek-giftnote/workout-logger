# Progress & agenda — Workout Logger

Living status file — the done / backlog tracker for this project. **Update it whenever work changes:**
finish a thing → move it to Done; pick up or think of a new thing → add it to the agenda; make a call
that isn't captured in the code → log it. Keep entries dated, newest near the top of each section.

_Last updated: 2026-06-30 (UI/UX + prod-readiness council audit)_

> Maintenance: a global Stop hook (`.claude/hooks/check-progress.sh`) blocks the end of a turn if any
> source/`.md` file in this folder is newer than this file — it nudges whenever the tracker falls
> behind. Self-clearing: updating (or `touch`-ing) `PROGRESS.md` makes it newest again. It can't see
> conversation-only decisions, so logging those is still on you.

## Pending decisions (needs Avishek)

- **Rotate the Atlas DB password + set a real JWT secret** — the `avishek_db_user` Atlas password was pasted
  in chat this session; the dev `SECURITY_JWT_SECRET` is a throwaway. Rotate before any real prod use.
- **Deferred coaching findings** (`docs/eval-findings.md`, evals pin current behavior under TODO):
  - Deload-floor magnitude for low-ceiling blocks (PEAK / STRENGTH-non-focus) — currently a deload can equal
    accumulation; should it step down relative to the block's own ceiling?
  - Dead-band anchor weight (regression-mean vs latest) in `EnergyService`.
- **Operational policy** (`DESIGN.md §8`): backup/PITR cadence; GDPR hard-delete vs tombstone retention
  (`rawImport` embeds PII); `startedAt`/bodyweight timezone policy; offline auth/token-refresh lifecycle.
- **Subscription model** — when/how to gate cloud sync (only the `SYNC_ENABLED` seam exists today; no billing).
- ~~**One-ACTIVE-plan-per-user** — enforce with a Mongo partial-unique index, or leave code-enforced?~~
  **Decided 2026-06-30: partial-unique index** (`plans {userId}|status=ACTIVE`), built at boot. See Done.

## Done

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
- **Subscription/entitlement layer** — gate cloud sync (flip `SYNC_ENABLED` per entitlement).
- **More UI testing tiers** — component (RTL) tests, visual regression, cross-browser E2E.
- **Tooling skills** (CLAUDE.md recommendations): `/restart-smoke`, `/diagrams`.

### Claude Code tooling gaps (learned but under-used)
- **Browser MCP** — Playwright MCP now wired in `.mcp.json` (pending activation); once live, use it to automate "verify in the running app". Atlas/MongoDB MCP wired alongside it for live DB inspection.
- **Council as a Workflow** — wrap `/council` in a Workflow to cut convene friction (skipped on small changes today).
- **Eval regression scorer** — add an eval-sweep-style baseline diff; suites pass/fail but don't report *what* regressed.
- **Project skills** — bottle recurring rituals (`/diagrams`, `/restart-smoke`).
