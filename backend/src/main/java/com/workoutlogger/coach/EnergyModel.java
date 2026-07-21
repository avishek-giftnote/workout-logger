package com.workoutlogger.coach;

/**
 * Versioned constants for the energy model. Every tunable the estimate depends on lives here so a better
 * formula retroactively corrects displayed numbers and so {@link EnergyService} emits a {@code modelVersion}
 * the client can key cache-busting/telemetry off. Bump {@link #MODEL_VERSION} whenever ANY constant below
 * changes — the energy test pins that contract (E17). Derive-on-read: nothing here is persisted.
 * See docs/coach.md "Energy model". NOT medical advice.
 */
public final class EnergyModel {
    private EnergyModel() {}

    /** Bump on ANY constant change below. v1 = shipped OLS engine; v2 = EWMA two-pass + 5-level ladder + workout term. */
    public static final int MODEL_VERSION = 2;

    // ── BMR / TDEE ────────────────────────────────────────────────────────────────────────────────────
    /** Mifflin–St Jeor sex offset. UNSPECIFIED is the exact arithmetic midpoint of male/female: (5 + −161)/2 = −78. */
    public static final double SEX_OFFSET_MALE = 5, SEX_OFFSET_FEMALE = -161, SEX_OFFSET_UNSPECIFIED = -78;
    /** PAL by ActivityLevel.ordinal(). NEAT/lifestyle activity; workout energy is a SEPARATE additive term (not rescaled in). */
    public static final double[] PAL = {1.40, 1.55, 1.70, 1.85, 2.00};
    /** Maintenance display half-range: ±8% for known sex, ±12% for UNSPECIFIED (extra sex-attribution uncertainty). */
    public static final double MAINT_HALF_RANGE = 0.08, MAINT_HALF_RANGE_UNSPECIFIED = 0.12;
    /** Rough resistance-session expenditure; workoutKcal ≈ sessions/week × this ÷ 7 (display-only, never fed to phase). */
    public static final double KCAL_PER_SESSION = 350.0;
    /** kcal per kg of bodyweight change — the slope→surplus/deficit conversion (over-states early water/glycogen weeks). */
    public static final double KCAL_PER_KG = 7700.0;

    // ── Data-sufficiency gate ─────────────────────────────────────────────────────────────────────────
    public static final int MIN_WEIGH_INS = 6;
    public static final int MIN_SPAN_DAYS = 14, MIN_SPAN_DAYS_FEMALE = 28;   // ≥1 menstrual cycle for cyclic water retention

    // ── Trend (EWMA) ──────────────────────────────────────────────────────────────────────────────────
    /** EWMA decay per day. α≈0.067 ⇒ ~10-day half-life (ln2/α). Females get the slower decay (wider window). */
    public static final double EWMA_ALPHA = 0.067, EWMA_ALPHA_FEMALE = 0.046;   // ~10d vs ~15d half-life

    // ── Classification ────────────────────────────────────────────────────────────────────────────────
    /** Dead-band as a fraction of the anchor weight (per week). Females widen it around cyclic water swings. */
    public static final double DEADBAND_FRACTION = 0.001, DEADBAND_FRACTION_FEMALE = 0.002;
    /** 5-level gate: above the N/span gate, ciWk beyond this multiple of the dead-band ⇒ TREND_ONLY (no phase verdict). */
    public static final double SE_GATE_DEADBAND_MULT = 3.0;
}
