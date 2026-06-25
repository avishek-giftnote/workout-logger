# Workout Logger — Council Simulation of the Planner Lifecycle

## Executive summary

A specialist council ran a stage-by-stage simulation of "Sam," a fictitious but realistic intermediate lifter, walking the Workout Logger planner lifecycle end to end on a phone — from registration through plan completion. The verdict is consistent across every stage: **the coaching engine is scientifically and structurally sound, but the app rarely tells the user that.** Almost every finding is a *surfacing* failure (labels, missing feedback, no onboarding) rather than an engineering or prescription bug — with three notable exceptions that are genuine reliability/data-integrity hazards (no offline/error states, in-progress workouts held only in React state, and an unvalidated primary save path).

---

## Method

**The council.** The simulation was run as a working session among three primary stakeholders, backed by two fact-checking roles:

- **Sam (the User)** — narrates each screen first-person on a phone, surfacing friction the way a real intermediate lifter would feel it (between sets, one-handed, sweaty thumb).
- **The Coach** — reacts to Sam's experience through an adherence-and-programming lens: is the prescription correct, and does the UI communicate it well enough that Sam trusts it?
- **The Exercise Scientist** — validates the underlying math and physiology (Mifflin–St Jeor, Student-t CI, RIR wave, double progression, volume landmarks) against cited literature (Schoenfeld 2016/2017, Israetel/RP landmarks, RTS/Tuchscherer).
- **System analysts + engineer fact-checkers** — including a completeness critic who probed the states the happy-path walkthrough skipped (dropped connections, refresh/crash, fat-fingered input).

**How they worked.** Ground truth first: the council read the **real code** (`PlanPage.tsx`, `periodization.ts`, `prescription.ts`, `CoachCard.tsx`, `WeekCalendar.tsx`, `EnergyService.java`, `engine.tsx`, the DTOs) to establish exactly how the app behaves — not how it is assumed to behave. Then they walked the lifecycle **stage by stage as a conversation** (User narrates → Coach reacts → Scientist validates). Finally, **every finding was fact-checked against the source** with file/line citations, and severity was adjusted up or down based on what the code actually does.

This was a simulation of the app's **real behavior**, not a design brainstorm. Where the narrative diverged from the code — e.g., the post-registration landing page is `/start` (LogWorkoutPage), not WorkoutsPage — the fact-check corrected it and noted the correction. Several findings were *downgraded* during fact-check (the block timeline does scroll rather than clip; recovery notes do update live, not only after confirmation), which is how a few "high" intuitions landed at "low."

---

## The test subject

**Sam** is 28, an intermediate lifter at 82 kg, training four days a week with the goal of building muscle. He opens the app for the first time on his phone with no prior context — no tutorial, no documentation, no assumptions about how the coaching engine works. He is exactly the user the app is built for, and exactly the user most likely to misread a raw enum label, miss an unlabeled button, or distrust a number he can't act on. Every stage below is his journey.

---

## The simulated journey

### Stage 1 — Onboarding & energy baseline

**What Sam did and saw.** Sam registers and is dropped straight onto a logging screen (`/start`) with no welcome, no setup wizard, and no prompt to complete his profile or log a bodyweight. He navigates to the Training Log and finds a Coach card stuck in **GATHERING_DATA** — "0/6 weigh-ins over 0/14 days" — with no button to resolve it. He eventually discovers that weigh-ins and profile fields (sex, DOB, height, activity level) live buried in the Settings sidebar. He can build a 6-month hypertrophy plan in under two minutes, but the path *to* that plan was a scavenger hunt.

> **Sam:** "It says 'gathering data, 0 of 6 weigh-ins.' Where do I even do that? There's no button here."
>
> **Coach:** "The engine behind your plan is correct — the GENERAL_HYPERTROPHY recipe, the Upper/Lower split with guaranteed ≥2×/week frequency, the MEV→MAV ramp. None of that needs to change. What's hurting you is that three compounding friction points block you from reaching it in a usable state: no onboarding path, an unexplained GATHERING_DATA state, and a 14-day energy gate that feels like the Coach is broken for two weeks. These are surfacing failures, not engineering failures."
>
> **Exercise Scientist:** "The science is ready and honest — Mifflin–St Jeor is implemented correctly, the Student-t CI on a small-n slope is the right architecture, and the 14-day / 6-weigh-in gate is scientifically defensible. But the activity-level label misnames what PAL actually measures, the intake-kcal field is collected and never used, and nobody tells you that HIGH confidence realistically needs 7–8 weeks of daily weigh-ins. The science is ready; the communication of it is not."

### Stage 2 — Macrocycle & mesocycle design

**What Sam did and saw.** Sam's 6-month Build-Muscle plan generates 24 weeks across 5 blocks: **HYPERTROPHY → HYPERTROPHY → STRENGTH → HYPERTROPHY → HYPERTROPHY**. The block timeline renders as a row of chips at `fontSize: 9` (`PlanPage.tsx:357–363`) that Sam squints at and cannot read. Block 3 says "Strength" — and Sam picked "Build muscle," so this reads like a bug.

> **Sam:** "Why is there a *Strength* block in the middle? I wanted to get bigger, not drop to 3-rep sets. And I can't even read the labels — they're tiny."
>
> **Coach:** "The mid-macro strength block is intentional — it potentiates the trailing hypertrophy pair. But nothing in the UI says that. The comment explaining it (`recipeUnit`, 'periodic resensitization / intensification') lives in the source and never reaches you. The most likely outcome is you tap 'End plan' two weeks into the strength block and lose the entire periodization benefit."
>
> **Exercise Scientist:** "And there's a real mechanical hazard here: cross-block progression fires a spurious load bump on the first session of the strength block. `nextLoad` compares your last hypertrophy reps (8–15) against the strength block's `repHigh` of 6 — your reps always exceed it, so it triggers a progression you didn't earn. Load selection for a new intensity block should anchor to an e1RM estimate, not inherit a reward from a different rep range."

### Stage 3 — Microcycle: split + weekly rest-day calendar

**What Sam did and saw.** Sam reviews the auto-generated split and the editable WeekCalendar — a read-only 7-cell grid on top, a separate row of native `<select>` dropdowns below (`WeekCalendar.tsx:29–65`). He changes a session's day in a dropdown and has to scroll *up* to confirm the grid updated. A recovery-conflict card warns "Chest is trained <48h apart" but doesn't say which day to move. The slot exercise dropdowns are native OS pickers showing only names — no mechanic, no equipment, no contribution fraction.

> **Sam:** "I moved Lower A to Wednesday in this dropdown… did it work? I have to scroll back up to the grid to check. And this conflict warning tells me there's a problem but not what to do about it."
>
> **Coach:** "Two things I confirmed from source that should worry you more than the layout. Upper B is programmed at **29 working sets** in week one — that's 90–115 minutes of working sets alone, beyond which it's junk volume for an intermediate. And a `setsPerDay` floor of 2 over-programs Front Delts at 4 sets/week against a 1-set target. There's a per-muscle cap (`PER_SESSION_CAP=5`) but no session-level total cap anywhere in the file."
>
> **Exercise Scientist:** "The periodization science is sound — Schoenfeld 2016, RP landmarks, the RTS table, the ≥2×/week guarantee all check out. But there's a false-precision data defect: a 3-month and a 4-month selection both produce an identical 14-week plan because of the `total + 2` break tolerance (`periodization.ts:505`), and the plan is still named '4 mo.' Sam selected a duration the app silently couldn't honor."

The highest-severity item at this stage is not science at all: **two `useEffect` hooks silently reset Sam's weekday assignments and slot picks whenever the preview recomputes** (`PlanPage.tsx:260–268`) — including when `measuredPhase` arrives asynchronously from the energy query. Sam customizes, the preview recomputes, everything reverts to defaults, and he taps Accept without noticing.

### Stage 4 — First session: prescription seeding + in-gym logging

**What Sam did and saw.** Sam logs his first Upper A session. The prescription is correct under the hood (8–15 reps, RIR 3 at week 1, double progression held until real loads exist), but the per-set RPE placeholder has no RIR translation, the bodyweight-mode toggle is an accidental-tap hazard, and a post-session dialog can corrupt the plan template.

> **Sam:** "It says RPE 7 next to this set. What does that mean I should actually do — how many in the tank? And I never entered my bodyweight; will these dips even count?"
>
> **Coach:** "The cold-start weight-0 loop is the single most dangerous thing here. If you tick a set without entering a weight, a 0 kg data point becomes the new `topWorkingSet` and poisons every subsequent prescription for that exercise for the rest of the plan. The programming is right; the logging UI doesn't protect it."
>
> **Exercise Scientist:** "Confirmed — and the RPE-to-1RM formula's linearity starts to drift at 15 reps, the top of your hypertrophy range. None of the *decisions* are wrong; they're missing guards at the edges of the engine."

### Stage 5 — Living plan: progression, volume, deload, meso transition

**What Sam did and saw.** Across five weeks Sam logs week-1 seeding, weeks 2–3 readiness ease, the week-4 hard week, a deload, and the hypertrophy→strength transition. The loop works. But the volume bars read like *failure* mid-week and during the deload, the readiness ease silently removes a set, and the RPE placeholders still give no actionable RIR.

> **Sam:** "My volume bars are half-empty mid-week — am I behind? And a set just… disappeared from this exercise. Why?"
>
> **Coach:** "The math is right, the framing is wrong. The bars look like failure because they show a partial week with no inline 'fills as you log' context. The readiness ease *correctly* trimmed a set for an under-recovered muscle — but the affordance explaining it is at the wrong scroll position, so it reads as a glitch. These will erode your trust and make you override correct prescriptions."
>
> **Exercise Scientist:** "The volume-bar rolling-window epoch is the most serious of these — the math is correct but the window anchor is wrong, making the bars systematically misleading mid-week with no physiological justification. And soreness chips capture only primary muscles, so synergists are invisible to the readiness pipeline — a structural gap that silently under-protects recovery."

### Stage 6 — Energy feedback & cycle completion

**What Sam did and saw.** Sam finishes the 6-month plan. Week advances give no feedback (silent tap → he taps again). The coach card shows his measured phase and rate but never judges whether his gain rate matches "Build Muscle." The completion screen shows aggregate stats but no progression arc. "Plan again, same settings" silently resets days to 4 (`PlanPage.tsx:82`).

> **Sam:** "I gained some weight — is that the *right* amount for building muscle? The card shows a number and stops. And did my 'Complete week' tap even register?"
>
> **Coach:** "The phase clamp downgrading SURPLUS to MAINTENANCE at HIGH-confidence DEFICIT is a clinically appropriate guard — the programming is fine. What fails you is the informational layer: no judgment on whether your gain rate matches the goal, no narrative arc at completion, and a silent days-reset on re-plan."
>
> **Exercise Scientist:** "An intermediate should gain roughly 0.15–0.50% BW/week; the app shows the raw number and stops. The completion screen's bodyweight delta is a first-to-last subtraction, not a trend-smoothed estimate, so ±0.3 kg of noise looks like signal — and e1RM gains mix RPE-adjusted and Epley formulas across sessions without disclosure. None of it is unsafe; it's calibration and communication."

---

## Findings

Sorted high → low severity.

| Severity | Area | Stage | Finding | Recommendation |
|---|---|---|---|---|
| **High** | UX / Systems | Cross-cutting | No error/offline state on any data load — a dropped GET mid-gym spins forever or seeds from empty history | Add `isError` + Retry to every query-gated page; wrap Shell in an error boundary; block session start when `me`/`workouts`/`exercises` error instead of `?? []` |
| **High** | UX / Systems | Cross-cutting | In-progress workout is pure React state — refresh, phone-lock crash, or nav-bar tap wipes the whole session | Persist active draft to the existing `LocalStore` seam (debounced) + restore prompt; add `beforeunload` + router blocker |
| **High** | ExerciseScience / Systems | Cross-cutting | Primary save path has zero input validation — a typo'd weight/reps/rpe persists and corrupts e1RM & progression | Mirror `UpdateSetRequest` bounds onto `CreateSetRequest`; add client-side "large jump from last time" warning |
| **High** | UX | Microcycle | Silent reset of weekday assignments + slot picks on any macro-parameter change (`PlanPage.tsx:260–268`) | Reset only on structural change (template/slot fingerprint); show inline notice when a reset is forced |
| **High** | ExerciseScience | Microcycle | Upper B prescribes 29 working sets — ~90–115 min, junk volume for an intermediate (`PER_SESSION_CAP` is per-muscle only) | Add a session-level total cap (~20–22 sets) that redistributes excess to another day |
| Medium | Coaching | Macrocycle | Strength block in a Build-Muscle plan has no explanation — reads as a bug | Per-block "why" note + rename "Strength phase" in the builder preview |
| Medium | ExerciseScience | Macrocycle | Cross-block progression fires a spurious load bump at hypertrophy→strength | Treat a block-type change as a warm cold-start; anchor load to e1RM, skip the rep-comparison gate |
| Medium | ExerciseScience | Macrocycle | Split locked to block-1 (hypertrophy) exercises through all 5 blocks, incl. Strength | Surface a compound-swap suggestion at strength-block transition |
| Medium | UX | Macrocycle | Block timeline chips illegible at 9px (`PlanPage.tsx:357–363`) | Scrollable card row, ≥13px text, plain-English per-block caption |
| Medium | UX | Onboarding | No onboarding flow — new user lands on an empty logging screen | One-time post-registration setup card → profile + first weigh-in → Plan builder |
| Medium | UX | Onboarding | Bodyweight buried in Settings; Coach card has no CTA | Inline "Log weight" CTA on the GATHERING_DATA card |
| Medium | Coaching | Onboarding | 14-day / 6-weigh-in gate never explained at first launch | Explain *why* time matters + cadence tip + optional back-date affordance |
| Medium | DataModel | Microcycle | 3-month and 4-month both produce identical 14-week plans (`total + 2`, `periodization.ts:505`) | Tighten tolerance / truncate final block; warn when delivered ≠ selected duration |
| Medium | UX / Coaching | Cross-cutting | "Complete week →" advances irreversibly with no confirm | Two-step confirm + an "undo last advance" affordance |
| Medium | ExerciseScience | Cross-cutting | Bodyweight exercise logged with no bodyweight set records load off bw=0 | Block completion with an inline bodyweight field; Vitest guard against weight '0' |
| Low | Coaching | Onboarding | GATHERING_DATA gives no profile-based maintenance preview though `maintLow/High` are already returned | Render the Mifflin estimate during gathering; add a builder banner |
| Low | UX | Microcycle | WeekCalendar dual-representation breaks one-handed use; conflict notes off-screen & non-prescriptive; native pickers hide metadata | Collapse to tap-on-cell day picker; amber-annotate conflicting cells; custom option rows with mechanic/equipment |
| Low | UX | Cross-cutting | No "first week — bars fill as you log" empty state for a plan-less / freshly-accepted coaching surface | Add an intentional first-week affordance unified with the GATHERING_DATA state |

### Detail on the HIGH-severity findings

**No error/offline state on any data load.** Every page renders only `isLoading` and `data` branches; not one renders TanStack Query's `isError`, and there is no React error boundary anywhere (a grep for `ErrorBoundary`/`componentDidCatch` returns nothing). `main.tsx` sets `retry: 1` and the fetch wrapper aborts at 12s with `ApiError(0, 'Network error…')`, but only *mutations* surface that error. So a failed `Api.me`/`listWorkouts`/`getPlan` — the normal condition for a phone in a basement gym — leaves `LogWorkoutPage` silently seeding from empty `?? []` (no progression) while `EditWorkoutPage`/`PlanPage` spin forever. The happy-path simulation treated the network as always-up; this is the most common real failure.

**In-progress workout is pure React state.** The live session in `LogWorkoutPage` (`started`, `blocks`, ticked sets) lives only in `useState`. There is no `beforeunload` guard, no draft persistence to the `LocalStore` seam the project already ships for settings (`src/local/LocalStore.ts`), and the top-bar nav buttons stay live during a workout — one tap unmounts the page and discards every set. A pull-to-refresh, an iOS tab eviction, or a fat-fingered nav tap silently wipes 40 minutes of leg day. The seam to fix this already exists; it was simply never wired to the logging path.

**Primary save path has zero input validation.** Set inputs in `engine.tsx` are free-text with only `inputMode` hints, and `toCreateSet` passes weight through as `orPrev(...) || '0'` with no range check. The backend validation is asymmetric: `UpdateSetRequest` (the rarely-used single-set edit) carries `@Min(0)@Max(1000)` reps and `@Min(1)@Max(10)` rpe, but `CreateSetRequest` — the bulk save **every** logged workout flows through — has **no** constraints at all. A fat-fingered "1000" instead of "100" is accepted, becomes the new `topWorkingSet`, and silently poisons `e1rm`/`progressedSeed`/`nextLoad` for the next session with no clamp and no recovery.

**Silent reset of weekday + slot picks.** Two `useEffect` hooks (`PlanPage.tsx:260–268`) reset `sched` and `picks` on every `preview` reference change, with no structural diffing. A particularly silent trigger: `measuredPhase` arriving from the async energy query *after* Sam has customized — all his edits vanish with no warning or undo, and he accepts a plan that has reverted to defaults.

**Upper B's 29 working sets.** `PER_SESSION_CAP=5` (`periodization.ts:331/172`) bounds sets *per muscle* only. Upper B carries seven muscle groups (CHEST/LAT/UPPER_BACK/FRONT_DELT/REAR_DELT/BICEP/TRICEP) because UPPER_BACK, REAR_DELT, and FRONT_DELT have frequency 1, concentrating their whole weekly allocation into one session. Week-1 SURPLUS totals ~29–30 working sets — at/beyond what advanced bodybuilders accumulate in a single session — with no session-level total cap anywhere in the file. The last 10–15 sets are junk volume by definition.

---

## Recommended roadmap

**Quick wins (surfacing fixes, no logic change).**
- Inline "Log weight" CTA on the GATHERING_DATA card, plus a one-line *why* and a cadence tip.
- Render the already-computed Mifflin maintenance estimate during the gathering window.
- Per-block "why" caption + rename "Strength phase"; bump timeline text from 9px to ≥13px.
- Two-step confirm on "Complete week →" / "Finish plan →"; success feedback on plan accept.
- Duration-mismatch notice when delivered weeks ≠ selected months.

**Worth doing (guards + interaction redesign).**
- **Wire durable drafts** to the existing `LocalStore` seam + `beforeunload`/router blocker — the single highest-value reliability fix for the core use case.
- **Mirror set-input validation** onto `CreateSetRequest` and add the client-side large-jump warning.
- **Add `isError` branches + an error boundary** across query-gated pages; stop seeding from empty on failed GETs.
- Fix the **silent state-reset** with structural diffing.
- A real **post-registration onboarding** flow (profile + first weigh-in → Plan builder).
- Collapse WeekCalendar to a single tap-on-cell interaction; annotate conflicting cells; richer exercise-picker rows.

**Bigger bets (engine-aware coaching).**
- **Session-level total-set cap** with redistribution (fixes Upper B's 29 sets at the algorithm level).
- **Block-aware progression** — treat block-type transitions as a warm cold-start anchored to e1RM, eliminating the spurious strength-block load bump; optionally regenerate a block-specific split suggestion at transition.
- **Coaching judgment layer** — translate measured gain-rate vs. goal targets into a verdict, surface confidence tiers, and add a true progression arc on the completion screen (trend-smoothed bodyweight delta, consistent e1RM formula).
- A unified "gathering data / fills as you log" coaching state shared across the energy gate and the first-week volume view.

---

## What the council validated as GOOD

For balance — the council repeatedly confirmed that the hard parts are *right*:

- **The planner science.** The GENERAL_HYPERTROPHY recipe (Hypertrophy → Hypertrophy → Strength), the MEV→MAV ramp at +2 sets/week, the RIR 3→0 wave, the phase modifiers, and the volume landmarks all match the cited literature (Schoenfeld 2016/2017, Israetel/RP, RTS/Tuchscherer). The mid-macro strength block is intentional and defensible potentiation.
- **Rest-day scheduling.** `scheduleWeek` exhaustively places training days to space same-muscle sessions ≥48h, and the recovery-conflict detection genuinely works (and updates live as Sam reassigns days).
- **Distinct-stimulus slots.** The ≥2×/week frequency-by-design guarantee, the per-muscle slot model with recommended defaults via the shared `trainsMuscle`/`fracOf` basis, and COMPOUND-narrowing for strength blocks are all correctly implemented.
- **Prescription seeding.** `topWorkingSet` selection, double progression held until real loads exist, e1RM/rpePct paths, and the readiness ease that trims volume for an under-recovered muscle are correct — the issues are *communicating* them, not computing them.
- **Energy gating.** Mifflin–St Jeor with correct sex constants, the Student-t CI (not z=1.96) on a small-n OLS slope, phase classification from the CI against a dead-band, and the HIGH-confidence-only phase clamp are statistically honest and clinically conservative — the system never claims more precision than it has at the point of *decision* (only at the point of *display*).
- **The completion screen** exists and aggregates the run; the bones are there for the progression-arc upgrade.

The throughline: **this is a well-engineered coaching engine wearing a UI that doesn't yet explain itself.** Close the surfacing gaps and wire the three reliability guards, and the math already underneath will finally be trusted by the Sam it was built for.