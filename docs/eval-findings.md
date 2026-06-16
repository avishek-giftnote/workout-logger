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

**Still deferred** (lower-severity, no decision needed yet):

| # | Location | Issue | Possible fix |
|---|---|---|---|
| 6 | `periodization.ts:66` targetSets deload | the deload floor `max(mv, round(mev·0.5))` is phase-independent (good) but for low-ceiling blocks (PEAK, STRENGTH non-focus, mv=0 muscles) it lands AT or ABOVE the accumulation target — not a real reduction | compute the deload floor relative to the block's own ceiling so low-ceiling blocks still step down (R24 currently pins only phase-independence) |
| — | `EnergyService.java:93` | dead-band anchored to the regression-mean weight vs the latest weight (a couple hundred grams apart mid-trend) | pin which weight anchors the band |
| — | `PlanRepository.java:40` | no DB partial-unique index enforcing one-ACTIVE-plan-per-user (purely code-enforced) | add a partial-unique index on `{userId, status:'ACTIVE'}` |
