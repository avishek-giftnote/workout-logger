# Coach: energy balance + volume-landmark programming

Design spec for the "Coach" system — inferring training **phase** (surplus / deficit / maintenance) from a
user's bodyweight trend and profile, and generating **volume-landmark** (MV/MEV/MAV/MRV) split recommendations
driven by goal, focus muscles, and recovery. Synthesized from two design councils (progression, then this
energy+volume council of 8 specialists incl. exercise scientist, sports nutritionist, sports statistician).

**Status:** design only. Layer 0 (profile + weigh-in capture) is the first thing to build. Nothing here
auto-changes a user's training, and none of it is medical or nutritional advice.

---

## Principles (non-negotiable)

1. **Weight *slope* is the source of truth for surplus/deficit — not the intake number.** The one-time
   calorie figure is a cold-start seed / sanity check only. `surplusDeficit_kcal/day ≈ slope_kg/day × 7700`
   (the 7700 constant over-states early bulk/cut weeks, since water/glycogen carry far less energy than fat).
2. **Hard data-sufficiency gate before *any* number.** Exclude the import backfill (one `estimated:true`
   value smeared across history). Require **≥14 days span AND ≥6 real weigh-ins** (≥28 days for menstruating
   users) and a slope standard-error below threshold. Server returns a status:
   `INSUFFICIENT_DATA → TREND_ONLY → PHASE_LOW → PHASE_MED → PHASE_HIGH`.
3. **Classify phase from the *confidence interval* of the weekly rate, never the point estimate**, with a
   **±0.10%-bodyweight/week dead-band** — default MAINTENANCE until the CI clears the band.
4. **Derive-on-read, never persist as fact** (like `lastWorkingSet`). Store only inputs (profile, weigh-ins,
   intake, muscle map). Optional memoized cache stamped with `{modelVersion, inputHash, computedAt}`.
5. **Never auto-apply.** A recommended split is a read-only *preview* that opens in the existing split/template
   editors; on **Accept** it creates a **new** split and never edits/deletes the user's current one. Phase is
   user-owned (Bulk / Cut / Maintain / Auto); inference only informs.
6. **Safety / ED guardrails are mandatory:** non-medical disclaimer + opt-in; **no daily calorie target, no
   goal-weight countdown**; calorie & rate-of-change floors; **rounded ranges + word-confidence, never a
   precise "2,418 kcal"**; dismissible/hideable panel; screen disordered-eating weigh-in patterns out.

---

## Energy model

Inputs the user **must** provide (cannot be inferred): `sex`, `dateOfBirth`, `heightCm`, `activityLevel`
(5-point), `goal`, and **one** `initialIntakeKcal` (entered once, with the date it reflects).

- **BMR — Mifflin–St Jeor** (needs only the four inputs above + latest real weight):
  `BMR = 10·kg + 6.25·heightCm − 5·ageYears + s`, where `s = +5` (male) / `−161` (female).
- **TDEE = BMR × PAL**, with workout energy split *out* into a separate volume-derived term (not baked into
  the multiplier). Activity → PAL: SEDENTARY 1.40 · LIGHT 1.55 · MODERATE 1.70 · ACTIVE 1.85 · VERY_ACTIVE 2.00.
- **Trend weight:** EWMA, ~10-day half-life (`α ≈ 0.067/day`, time-decayed for irregular cadence). Never let a
  single raw weigh-in move an estimate. Store the smoothed series as derived/recomputable; never overwrite raw.
- **Self-correcting estimate:** a scalar Kalman-style adaptive filter seeded by Mifflin, updated as weigh-ins
  arrive. Surplus/deficit magnitude comes from the **slope** (`slope_kg/day × 7700 / 1`), independent of intake
  once a slope exists. The intake figure calibrates the cold-start display only — **do not** fit a persisted PAL
  from it.
- **Menstruating users:** widen the dead-band and smoothing window around cyclic water retention; require the
  longer (≥28-day) span before classifying.

---

## Volume engine

**Prescribe at the muscle level, not the exercise level.**

### Per-exercise muscle map
`Exercise.muscleContributions: List<{muscle, fraction}>` — fractions as decimals-on-the-wire, **primary 1.0,
secondary 0.3–0.5**. 14-muscle enum: CHEST, FRONT_DELT, SIDE_DELT, REAR_DELT, LAT, UPPER_BACK, TRAP, BICEP,
TRICEP, FOREARM, QUAD, HAMSTRING, GLUTE, CALF, ABS. Examples:
`Bench = {CHEST 1.0, FRONT_DELT 0.5, TRICEP 0.5}` · `Squat = {QUAD 1.0, GLUTE 0.5, HAMSTRING 0.3}`.
Seed by `nameKey` for known lifts; **flag unmapped** (an unmapped lift silently zeroes volume — the #1
garbage-in risk); each contribution carries `source (SEED|USER|INFERRED) + sourceVersion + role`.

**A weekly hard set for a muscle = Σ (that muscle's fraction) over working (non-warmup) sets that week.**
**Do not gate on RPE** (≈14–47% populated) — use reps-in-hypertrophy-range as the gate; RPE is a bonus signal.

### Volume landmarks (weekly hard sets / muscle, editable defaults)

| Muscle | MV | MEV | MAV | MRV |
| --- | --- | --- | --- | --- |
| Back / Lats | 6 | 10 | 14–18 | 22 |
| Quads | 6 | 8 | 12–16 | 20 |
| Hamstrings | 4 | 6 | 10–14 | 16 |
| Glutes | 0 | 4 | 8–12 | 16 |
| Chest | 4 | 8 | 12–16 | 20 |
| Side / Rear delts | 0 | 6 | 12–18 | 26 |
| Front delts | 0 | 0 | 6–8 | 12 |
| Biceps | 4 | 6 | 10–14 | 20 |
| Triceps | 4 | 6 | 10–14 | 18 |
| Traps / Calves / Abs / Forearms / Upper-back | 0 | 6 | 10–16 | 20+ |

### Progression, phase modifier, recovery
- **Always start each block at MEV; progress +2 sets/muscle/week.** Phase never sets the *floor*.
- **Energy phase is a *bounded modifier*** (±~one band-step, ≈±15% of the MAV−MEV span), applied **only at HIGH
  confidence**: SURPLUS pushes toward MAV/MRV; MAINTENANCE lives at MAV; **DEFICIT pulls toward MEV with
  intensity held constant** (cut volume, never load — *no light "pump" work in a cut*). Low confidence ⇒ treat
  as maintenance.
- **Recovery = one 3-state tap per trained muscle at workout-finish** (under-recovered / recovered / easy,
  default recovered), fused with the objective est-1RM / volume-load regression we already compute. No sleep/HRV.
- **Focus vs balance:** focus muscles get the upper half of their band; their direct antagonist gets a
  maintenance MEV floor; everything else gets MV→MEV. **Frequency is *derived* from volume** (split a muscle's
  weekly sets across ≥2 sessions once it exceeds ~8–10) → drives the generated template count.

### Mesocycle / deload (deferred past MVP)
4–6 wk accumulation (MEV→near-MRV) → 1 wk deload (~MV / RPE 5–6). Deload cadence = the **earliest** of: fixed
5 wk · any muscle hits MRV · recovery + performance regression on 2 consecutive sessions · est-1RM trend flat
across the block. Surplus stretches cadence toward 6 wk; deficit shortens toward 4. Needs a stateful
`Mesocycle` doc — **explicitly out of the MVP** (the volume preview is stateless single-shot for v1).

---

## Data model additions (all additive, nullable, migration-free)

- **`User.profile`** (embedded, nullable): `dateOfBirth`, `heightCm`, `sex (MALE|FEMALE|UNSPECIFIED)`,
  `goal (GAIN_MUSCLE|LOSE_FAT|MAINTAIN|GAIN_STRENGTH)`, `activityLevel (SEDENTARY..VERY_ACTIVE)`,
  `initialIntakeKcal`, `initialIntakeAt`, `focusMuscleGroups`.
- **`User.bodyweightLog`** already exists (`recordedAt, weightKg, estimated`) — promote it to a real
  time-series in the UX; exclude `estimated:true` rows from all fits.
- **`Exercise.muscleContributions`** (embedded list; primary/secondary fraction + source).
- **`volumeLandmarks`** (per-user override doc; falls back to the table constants) and the `7700 kcal/kg`
  constant — stored as **versioned** values so a better formula retroactively corrects displayed numbers.
- Everything else (trend weight, TDEE, phase, per-muscle tallies, the proposed split) is **derived on read**.

---

## Phased plan (each layer is useful and reversible on its own)

- **Layer 0 — Profile + weigh-in capture (no inference).** Nullable `User.profile` + a real weigh-in widget
  (append non-estimated entries to `bodyweightLog`). Unlocks bodyweight-trend charts. ← **build first**
- **Layer 1 — Muscle map + per-muscle volume charts.** `muscleContributions` (seeded, user-editable) +
  weekly-set-vs-landmark charts. Fully decoupled from energy inference.
- **Layer 2 — Energy "Coach" card (read-time, gated).** Mifflin + PAL + slope → phase behind the data gate +
  disclaimer; rounded ranges + word-confidence.
- **Layer 3a — Stateless volume preview.** Trailing-window logged sets + recovery taps + (gated) phase → one
  proposed split placed at MEV with the bounded phase modifier; Accept creates a new split. ✅ built
- **Layer 3b — Stateful mesocycle/deload engine.** ✅ built — `Macrocycle` (cursor `mesoIndex`/`week`) + per-week
  `targetSets`; `DELOAD` workouts excluded from progression charts.
- **Layer 4 — Macrocycle planner.** ↓ designed by council, below.

---

## Layer 4 — Macrocycle planner (council-designed)

Generate a months-to-year+ training arc from a **goal + duration/target-date**, broken into a sequence of
mesocycle **blocks**, plus a **split + templates with exercises** for the current block. Extends the existing
`Macrocycle`/`Mesocycle` model additively; **never auto-applies** (preview → Accept creates plan + split +
templates, never mutates existing).

### Keystone: two orthogonal axes
`targetSets` today welds the volume ceiling to the **energy phase** (SURPLUS→MRV / DEFICIT→MAV[0] /
MAINTENANCE→MAV[1]) — so a low-volume **STRENGTH/PEAK block in a contest-prep deficit is unrepresentable**.
Split them:
- **`blockType`** (new, nullable; null ⇒ HYPERTROPHY) drives the **volume band + rep target**.
- **energy `phase`** drives a **multiplicative deficit-trim** on top.

| blockType | volume ceiling (focus) | reps / RIR (intensityBand) |
| --- | --- | --- |
| HYPERTROPHY | MRV (non-focus MEV) | 8–15 @ RIR 1–2 (~65–75% 1RM) |
| STRENGTH | MAV-low | 3–6 @ RIR 1–2 (~80–90%) |
| PEAK | MV | 1–3 @ ~90%+ |
| RESENSITIZATION / MAINTENANCE | MV (all) | light |
| PREP | hypertrophy band, trimmed | 8–15, deficit-trimmed toward MEV |

`Mesocycle` gains nullable `blockType` + `intensityBand {repLow, repHigh, targetRir, pctLow?, pctHigh?}`
(reps are the primary contract; %1RM optional). `Macrocycle` gains nullable `goal`, `targetDate`,
`focusMuscles`. Set counts stay plain ints; only weights are decimals-as-strings.

### Goal → block recipe (`planMacrocycle`, pure, tested)
Work **backward from `targetDate`** when present (the terminal block is immovable; accumulation absorbs slack);
else forward from now for `durationWeeks`. Every block = N accumulation (3–5, default 4) + 1 deload; snap
fractional math to whole blocks. Enforce **phase potentiation** (no STRENGTH before ≥1 HYPERTROPHY; PEAK is
terminal-only and date-gated).
- **GENERAL_HYPERTROPHY** — repeat `[HYP 4+1]×2 → [STRENGTH 3+1]` (the strength block doubles as periodic
  resensitization), no pinned focus; volume MEV→MAV.
- **MUSCLE_FOCUS** — same, but `focusMuscles` (1–3, capped) pinned every block → focus → MRV band, others held
  at MEV (specialization).
- **STRENGTH** — HYP → STRENGTH → STRENGTH(peak-ish), volume down / intensity up each block; terminal STRENGTH
  or a 2–3 wk PEAK if dated.
- **CONTEST_PREP** (requires `targetDate`, phase DEFICIT) — chain DEFICIT hypertrophy/maintenance blocks (each
  4+1), focus held near MAV-low trimming toward MEV as weeks-to-show shrink, ending in a **1–2 wk PEAK** block
  anchored to the date; optional SURPLUS off-season blocks before the cut if the runway allows.

### Split / template generation
Generate a split + templates **for the current (first) block only**; distal blocks stay as **intent**
(type/weeks/focus snapshot). The same pure function computes the **preview and the accept payload**, so
preview == accept.

**Frequency (≥2×/week per muscle) — by design, not by warning.** Schoenfeld et al. 2016 (volume-equated
meta-analysis): training a muscle **≥2×/week beats 1×** for hypertrophy. Split **shape by days/week** seeds
this — **2–3d Full-Body, 4d Upper/Lower×2, 5d U/L + PPL, 6d PPL×2** — and the planner then **guarantees it
constructively**: any **prime mover** (chest, lats, quads, hamstrings, glutes, side-delts, biceps, triceps) or
**focus muscle** the base shape would hit <2× is **added to the lightest day(s) that lack it** until it reaches
2× (so e.g. side-delts on a 4-day Upper/Lower, which the old shape hit once, is now scheduled twice). A muscle's
weekly target is **spread across its sessions** and **capped at ~5 sets/session** (junk-volume ceiling). Only a
true **catalog gap** (no exercise for a muscle) still warns — frequency itself no longer does.

**Boilerplate slots → user-selectable exercises.** Each training day is emitted as a list of **muscle-group
slots** — placeholders carrying a prescription (sets×reps@RIR) and a **recommended default exercise the user can
swap** (in `PlanPage`) for any catalog exercise that trains the same muscle. A muscle's per-day volume splits
into `⌈sets / 3⌉` slots, **≤2 distinct exercises per muscle per day** and bounded by how many candidates exist —
so a ~4-set chest day becomes two slots (e.g. an incline press + a pec deck), a 3-set lat day stays one. Pure +
swept: `daySlots` (periodization.ts) builds them; the eval pins slot integrity and the ≥2× design guarantee
(R33–R35). On **accept**, each slot resolves to the user's chosen `exerciseId` and persists as an ordinary
template (slots that landed on the same exercise merge, sets summed/capped) — the slot concept is plan-time only.

**Exercise selection (goal-aware).** Defaults are picked from the **user's catalog** by muscle
(`muscleContributions`, fallback `MuscleSeed.infer`). **STRENGTH/PEAK blocks prefer COMPOUND** movements;
hypertrophy mixes compound + isolation. Candidates **rotate across slots/days** for variety (e.g. barbell bench
one day, incline dumbbell the next), and the per-slot dropdown lists every catalog exercise that trains that
muscle so the user has the final say. **Catalog-coverage gaps are first-class output** — warn ("side-delt needs
a lateral-raise you don't have") rather than silently under-deliver.

### Mesocycle → mesocycle transitions
Each block ends in its **deload week** (volume → ~MV, intensity held); the next block **restarts volume at
MEV** and ramps to its `blockType` ceiling — the deload *is* the transition and the MEV-reset. Block order
obeys **phase potentiation** (no STRENGTH before ≥1 HYPERTROPHY; PEAK terminal/date-gated), and a periodic
STRENGTH/RESENSITIZATION block every ~3rd mesocycle restores the MEV→MRV runway on long macros.

### Top risk
A **confidently-wrong, over-long auto-plan** the user accepts wholesale (peak placed a week off; a deficit
block ramping toward MRV; a focus muscle with no catalog exercise). Mitigations: backward-from-date with an
immovable terminal block, every set/exercise an **editable preview**, coverage warnings, accept is additive
(creates, never mutates), and only the current block's training is materialized.

---

## Layer 5 — Prescription, recovery & autoregulation (coach-grade numbers)

Closes the gaps that a real coach wouldn't leave: the planner now **populates exact loads/reps/RIR**, **respects
recovery between sessions for the same muscle**, **scales to the energy phase**, and **updates as you log**
(a *living* plan). Decisions locked from web research (RP volume landmarks, Tuchscherer/RTS RPE chart, Zourdos
2016, Schoenfeld 2017, Helms/Henselmans, Epley/Brzycki) + user answers. Stays additive + accept-creates-never-mutates.

**Build order (locked):** ① energy-phase modifiers → ② populate numbers → ③ recovery-aware sequencing →
④ over-time autoregulation. Each is a shippable, tested slice.

### ① Energy-phase modifiers — `PHASE_MODIFIERS`
The energy phase is one axis (blockType is the other, Layer 4). Volume is a **bounded band-step** on the
ramped target (≈±15% of the MAV−MEV span — *not* a multiplicative scale of the ceiling); `rirFloor` and
`progressMult` drive effort/load:

| phase | `volumeBandSign` (× round(0.15·(MAV_high−MEV)) sets) | `rirFloor` (don't grind below) | `progressMult` (load-progression rate) |
| --- | --- | --- | --- |
| SURPLUS | +1 (one band-step up) | 0 | 1.0 (full increments) |
| MAINTENANCE | 0 | 0 | 0.5 (slow gain) |
| DEFICIT | −1 (one band-step down) | 1 (≥1 RIR, preserve don't grind) | 0.1 (hold loads) |

`targetSets` adds `volumeBandSign · bandStep` to the MEV→ceiling ramp; `rirFloor`/`progressMult` are consumed
by slices ②/④. The block phase comes from the goal recipe but is **clamped by the Coach's measured phase**
(HIGH-confidence only): a recipe SURPLUS is downgraded to MAINTENANCE while a sustained DEFICIT is measured —
the plan never prescribes extra volume + faster progression while you're cutting.

### ② Populate numbers — the prescription engine (pure, tested)
- **RPE→%1RM (one linear formula, no table):** `pct = 100 − 2.5·(reps − 1) − 5·RIR`, clamped to `[0.40, 1.0]`
  — i.e. one rep ≈ 2.5%, one RIR ≈ 5% (matches the RTS/Tuchscherer chart: RPE 8 / 2 RIR at 5 reps = 80%).
  Treat >12-rep isolation as rep-driven.
- **e1RM seed:** from a logged top set *through the same RPE math* (`e1RM = weight ÷ pct`), else Epley
  (`w·(1+reps/30)`). **No cold-start load:** with no logged history the prescription shows **reps + RIR only**
  and the load is logged on the first session, then progresses (product decision — anchors were rejected as
  too inaccurate).
- **Working load:** `round_inc(e1RM · pct(target_reps, target_RIR))` — increments 2.5 kg compound / 1.25 kg
  isolation; bodyweight exercises progress on **reps** (the load is an added/assist delta logged on the day).
- **MEV by experience** (beginner ~6–8 → advanced ~12–14 sets/muscle), **per-session cap ~10 sets/muscle**,
  ≥2× frequency (Layer 4). The generated split is filled with **exact sets × reps × RIR × load** (full fixed
  prescription), still an editable preview.

### ③ Recovery-aware sequencing + readiness
- **Spacing:** order the microcycle so a muscle (and its synergists, via secondary `muscleContributions` —
  bench→triceps) isn't re-trained inside **~48–72 h**; the window grows with last session's sets/closeness to
  failure.
- **Readiness (v1, user-chosen):** logged soreness + a performance drop (reps/e1RM down vs target) **trim the
  next same-muscle session** (−sets / +1 RIR) — autoregulation, not just static spacing.

### ④ Over-time autoregulation — the living plan
- **Recompute e1RM on every logged session**; pre-fill the next session's suggested load/reps via **double
  progression** (reps to top of range at target RIR → then +load: +2.5–5 kg lower / +1–2.5 kg upper, ×
  `progressMult`).
- **RIR wave** across the meso (3→2→1→0–1), floored by `rirFloor`.
- **Deload triggers** (reached MRV / performance drops >2 sessions / end of block) **prompt** (don't force) the
  deload week (~½ MEV sets, +2–3 RIR).

### Top risk
Confidently-wrong *numbers* the user trusts blindly (a cold-start load way off; a deficit plan still adding
weight; a readiness trim that masks a bad day as under-recovery). Mitigations: every number an **editable
preview**, conservative cold-start that self-corrects in 1–2 logs, `progressMult`≈0.1 in a deficit, and
readiness adjustments are **suggestions** shown with their reason — never silent.

---

## Top risks (every member flagged the same one)

A **confidently-wrong TDEE/phase off sparse, noisy weight data that compounds into a bad volume prescription**
— a 1.5 kg water swing ×7700 = a phantom ~1,600 kcal/day deficit → classified DEFICIT → generator pulls toward
MEV when the user wanted to grow. Plus: the **bodyweight series doesn't exist yet** (cold-start is
going-forward-only; first trustworthy slope ~3–4 weeks after real weigh-ins begin), **female menstrual water
retention**, **weigh-in frequency bias** (people weigh more when motivated → not missing-at-random), and the
**muscle map** being hand-curated with no ground truth. Every mitigation above (data gate, CI classification,
bounded modifier, human ratification, unmapped-exercise flagging) exists to contain this chain.
