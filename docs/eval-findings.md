# Eval council — deferred design decisions

The full-project eval build (logging / planner / prescription / energy / plan-state-machine) was vetted by
the specialist council. It ratified a 62-rule invariant catalog (encoded as `L##` logging, `R##` planner +
prescription, `E##` energy, `SM##` state-machine across the `*.eval.test.ts` suites + backend tests) and
surfaced 14 code findings.

**Fixed in this change** (clear-cut bugs, failing-test-first): L1 bodyweight float drift, R21 volume
escaping MRV, R28/R29 CONTEST_PREP calendar overshoot, SM2 `accumulationWeeks` domain clamp, SM5
`intensityBand` validation (`pctLow ≤ pctHigh`, `targetRir`).

**Deferred — these need a product decision** (docs/coach.md says one thing, the code does another). The
evals pin **current** behavior with a `TODO(eval-finding)` marker so the suite is green; flip the assertion
when the decision is made.

| # | Location | docs/coach.md intent | Current code | Decision needed |
|---|---|---|---|---|
| 1 | `periodization.ts:98` clampPhase | phase modifier applies only at **HIGH** confidence; default to MAINTENANCE on UNKNOWN/LOW | keeps SURPLUS unless measured phase is literally `DEFICIT`; confidence not threaded into `planMacrocycle` | thread `EnergyService.confidence` into the planner + downgrade SURPLUS unless HIGH-confidence? (signature change) |
| 2 | `periodization.ts:72` focus path | focus muscle trimmed **toward** MEV in a deficit | driven **below** MEV (e.g. SIDE_DELT→4 vs MEV 6) | floor focus-muscle deficit volume at MEV? |
| 3 | `prescription.ts:84` nextLoad | MAINTENANCE = "slow gain", distinct from SURPLUS "full increments" | MAINTENANCE (0.5) and SURPLUS (1.0) progress load identically (mult is only a deficit on/off switch) | make `progressMult` a real rate multiplier, or document they intentionally match? |
| 4 | `EnergyService.java:92` | conservative CI | hardcoded z=1.96 even at n=6 (df=4, true t≈2.78) — understates CI ~30% at small n, calls are over-decisive | use small-n t-multiplier keyed to n−2? |
| 5 | `prescription.ts:16-18` e1rm | one est-1RM | RPE-path and Epley-path diverge for the same set (315×5@RPE8 → 393.75 vs 367.5) → prescription jumps when RPE logging starts | reconcile the two paths, or accept the discontinuity? |
| 6 | `periodization.ts:66` targetSets deload | deload steps volume DOWN | the deload floor `max(mv, round(mev·0.5))` is phase-independent (good) but for low-ceiling blocks (PEAK, STRENGTH non-focus, mv=0 muscles) it lands AT or ABOVE the accumulation target — i.e. not a real reduction | compute the deload floor relative to the block's own ceiling so low-ceiling blocks still step down? (R24 currently pins only phase-independence) |

**Lower-severity, also deferred:** deadband anchored to regression-mean weight vs latest (`EnergyService.java:93`);
no DB partial-unique index enforcing one-ACTIVE-plan-per-user (`PlanRepository.java:40`).
