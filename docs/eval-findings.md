# Eval council — deferred design decisions

The full-project eval build (logging / planner / prescription / energy / plan-state-machine) was vetted by
the specialist council. It ratified a 62-rule invariant catalog (encoded as `L##` logging, `R##` planner +
prescription, `E##` energy, `SM##` state-machine across the `*.eval.test.ts` suites + backend tests) and
surfaced 14 code findings.

**Fixed in this change** (clear-cut bugs, failing-test-first): L1 bodyweight float drift, R21 volume
escaping MRV, R28/R29 CONTEST_PREP calendar overshoot, SM2 `accumulationWeeks` domain clamp, SM5
`intensityBand` validation (`pctLow ≤ pctHigh`, `targetRir`).

**Resolved** (decisions made; failing-test-first, evals flipped to the chosen behavior):
- **D1 — confidence-gated clamp** (`periodization.ts` `planMacrocycle`): the function now takes
  `measuredConfidence` and applies a measured-phase override ONLY at HIGH confidence (enforced in the
  planner, not just at the UI call site). Decision: under low/unknown confidence the recipe's aspirational
  phase stands (don't under-prescribe volume for new users). Pinned by `R25` (HIGH clamps, LOW ignored).
- **D2 — focus floored at MEV** (`targetSets`): a focus muscle is trimmed only toward MEV, never below it
  (capped by the block ceiling so a low-volume PEAK still holds). Pinned by `D2-focus-mev-floor`.
- **D3 — MAINTENANCE slow gain** (`nextLoad`): maintenance must beat the top of the range by one extra rep
  before adding load (an extra session at the top) — slower than a surplus, faster than a held deficit.
  Pinned by `D3-maintenance-slow` / `D3-surplus-loads-at-top`.
- **D4 — small-n t-multiplier** (`EnergyService.java`): the CI half-width uses a Student-t value keyed to
  df = n−2 (≈2.78 at n=6) instead of a flat z=1.96. Pinned by `usesSmallSampleTMultiplierNotZ`.
- **D5 — keep both e1RM paths** (`e1rm`): the RPE-adjusted estimate intentionally refines Epley UPWARD on a
  sub-failure set (that shift is information, not noise); Epley is the conservative no-RPE fallback. No code
  change; the behavior is documented and pinned by `D5-rpe-refines-up`.

## Energy-model upgrade — council 2026-07-21 (`/autopilot`)

A deciding council (energy-analyst · sports-data-expert · data-modeler · systems-architect, 2 rounds + Opus
synthesis) closed the gap between the shipped Layer-2 model and its `docs/coach.md` design. Decisions (this
repo decides, it doesn't defer) — each pinned as a numbered `E##` guard written failing-first:

- **EWMA over Kalman (Q1, 4/4).** Ship the time-decayed EWMA (~10-day half-life); reject the scalar Kalman
  filter. A fixed-gain EWMA *is* the steady-state scalar Kalman, so at ~1-user scale Kalman only adds
  unfittable Q/R magic numbers, and derive-on-read bans persisting the running estimate anyway.
- **Slope — Theil–Sen, NOT the council's literal "OLS on the EWMA-smoothed series" (implementer deviation,
  evidence-logged).** OLS-on-smoothed was empirically wrong on this app's short windows: a forward EWMA lags a
  ramp, so it **attenuated a clean +0.40 kg/wk trend to +0.25 (38% low) and inflated its CI** (raw residuals
  about the lagged line), which would force decisive trends into `TREND_ONLY`. Theil–Sen (median of pairwise
  slopes) is unbiased, has **zero tunables** (more faithful to the council's anti-false-precision stance),
  and delivers the single-point robustness the whole EWMA exercise targeted: a −5 kg outlier that flips plain
  OLS to a false DEFICIT leaves Theil–Sen at +0.40 (`E14`). The CI is still honest **raw** scatter about the
  robust line (council Q5 intent), `df=n−2` on real weigh-ins. EWMA is retained for the dead-band anchor +
  trend display. *Flagged to the review council; it verified the estimator behaves as claimed.*
- **Workout energy split (Q2).** A minimal additive term: the caller passes a trailing-7-day session count
  into `estimate()` (service stays pure/repository-free); DTO reports `neatBmrKcal` + `workoutKcal` as
  decomposed **display-only** fields; **PAL is not rescaled** (a guessed rescale factor is the same n=1
  calibration trap as Kalman); the overlap is made transparent via a UI caveat + "activity outside workouts"
  label rather than silently baked in. Pinned by `E17`/`E18`.
- **Dead-band anchor (Q3).** Migrated from the regression mean (`ȳ`) to the **latest EWMA-smoothed weight** —
  noise-robust *and* current, resolving the deferred "dead-band anchor" finding. Pinned by `E20`.
- **Female span (Q4a).** `21 → 28` days (≥1 menstrual cycle); a real code bug vs the doc. Pinned by `E8`.
- **SE gate (Q4b).** One new tier: `ciWk > 3× dead-band ⇒ TREND_ONLY`, denominated in the t-inflated `ciWk`
  (not raw SE), sitting above the shipped 2×-dead-band MEDIUM floor so the HIGH/MED/LOW formula is unchanged
  (regression-locked). Pinned by `E11`/`E12`/`E13`. *Note:* with Theil–Sen the CI is ~0 for clean data and
  large for any scatter, so a **decisive** `PHASE_LOW` is unreachable (collapses to `TREND_ONLY`) — acceptable,
  even desirable for the ED guardrail (no wishy-washy phases).
- **UNSPECIFIED sex.** Keep the `−78` offset, documented as the midpoint of `+5`/`−161` (`E9`); widen its
  maintenance **display** range to `±12%` (`E10`) for the extra sex-attribution uncertainty (display-only).
- **Versioning.** `modelVersion` (now 2) on every `EnergyDto`; all tunables in `EnergyModel` (`E19`).

**Deferred (logged, not dropped) — structural-break guardrail.** The council *added* an 11th item: flag
estimates "provisional / wider-banded" for the first 3–4 weeks after a goal/phase change, to contain the
`7700 kcal/kg` early-water/glycogen bias (its stated top residual risk). **Deferred** because it is net-new
design absent from `docs/coach.md`, needs a **segment-start marker** data model (tracking when the user last
changed goal/phase — no such field exists), and the council's own synthesis says the tightened `ciWk` gate
already contains the risk. Recommended as the next energy follow-up; would add an `E##` for "within N weeks of
a segment start, the estimate is flagged provisional regardless of the CI tier."

### Energy upgrade — review council (2026-07-21, adversarial oversight)

A 4-lens review council (energy-analyst · eval-engineer · backend-engineer · test-user) adversarially verified
the shipped change. Confirmed findings and their resolution:

- **[HIGH — fixed] Absolute `TREND_ONLY` gate suppressed decisive fast trends.** `ciWk > 3× dead-band` was
  applied globally, so a real −1.0 kg/wk cut with mild scatter (CI entirely below the band) returned
  `TREND_ONLY` and never `PHASE_HIGH` — the planner clamp effectively never fired for the cut/bulk users it
  exists for. **Fixed:** `TREND_ONLY` only when the CI **straddles** the dead-band (phase would be MAINTENANCE)
  *and* `ciWk > 3×` it; a one-sided CI classifies decisively however wide. This matches the council's original
  Q4b *intent* ("too wide to even say MAINTENANCE"). Guard `E21` (regression), gate math re-pinned in `E11`–`E13`.
- **[MEDIUM — fixed] `PHASE_LOW` was unreachable/untested.** With the straddle-only gate `PHASE_LOW` is now a
  reachable low-confidence MAINTENANCE and is pinned by `E13`; the wire-contract wording (types.ts, coach.md) was
  corrected — the PHASE_* levels are confidence tiers of the *classification* (which may be MAINTENANCE), and a
  decisive SURPLUS/DEFICIT is always ≥ MEDIUM.
- **[MEDIUM — fixed] Single-outlier verdict drop / overstated docstring.** Theil–Sen keeps the *rate* robust,
  but a lone outlier inflates the raw-residual CI and can drop the verdict to `TREND_ONLY`. This fails **safe**
  (removes the clamp, never manufactures a wrong decisive phase). The class Javadoc (which still described the
  abandoned OLS-on-smoothed design) and the "cannot flip the phase" comment were corrected to state exactly this;
  `E14` now pins the safe `TREND_ONLY` drop.
- **[HIGH-UI — fixed] "Surplus ≈ 600–600 kcal/day".** A tight CI bucketed both bounds to the same 50-kcal value,
  rendering an identical-bounds range that reads as broken. `CoachCard` now collapses equal bounds to a single
  value (`kcalRange`).
- **[LOW — fixed] `−0.00 kg/week`** near-zero rate display snapped to `+0.00`; **t-table cliff at df=31** smoothed
  by extending `T95` to df=40.
- **[MEDIUM — deferred] Pill prominence.** `PHASE_LOW`/`PHASE_MEDIUM` render the same assertive pill as
  `PHASE_HIGH` though only HIGH clamps the plan; the confidence caption is the only cue. Post-fix `PHASE_LOW` is
  always MAINTENANCE (a soft "Maintenance" pill), so the sharp case is only `PHASE_MEDIUM` deficit/surplus, where
  the "medium confidence" caption shows. Logged as a UX polish follow-up (de-emphasize the pill below HIGH).
- **[LOW — deferred] Same-day weigh-ins counted as independent** in `n`/`df` (a twice-daily logger clears the
  gate with ~half the independent days). Fix = collapse same-calendar-day readings to a daily median before the
  fit. Deferred (low severity, changes `n` semantics); logged for the next energy pass.
- **[LOW — deferred] The CI is a conservative proxy, not a formal Theil–Sen (Kendall-τ) interval.** It never
  produces a wrong decisive output (it overstates uncertainty). Documented as a deliberate proxy; a true
  pairwise-slope-distribution CI is a possible future refinement.

**Still deferred** (lower-severity, no decision needed yet):

| # | Location | Issue | Possible fix |
|---|---|---|---|
| 6 | `periodization.ts:66` targetSets deload | the deload floor `max(mv, round(mev·0.5))` is phase-independent (good) but for low-ceiling blocks (PEAK, STRENGTH non-focus, mv=0 muscles) it lands AT or ABOVE the accumulation target — not a real reduction | compute the deload floor relative to the block's own ceiling so low-ceiling blocks still step down (R24 currently pins only phase-independence) |
| — | `EnergyService.java:93` | dead-band anchored to the regression-mean weight vs the latest weight (a couple hundred grams apart mid-trend) | pin which weight anchors the band |
| — | `PlanRepository.java:40` | no DB partial-unique index enforcing one-ACTIVE-plan-per-user (purely code-enforced) | add a partial-unique index on `{userId, status:'ACTIVE'}` |
