package com.workoutlogger.coach;

import com.workoutlogger.domain.ActivityLevel;
import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.Profile;
import com.workoutlogger.domain.Sex;
import com.workoutlogger.domain.User;
import com.workoutlogger.web.dto.ApiDtos.EnergyDto;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class EnergyServiceTest {

    private final EnergyService svc = new EnergyService();

    private User user(boolean withProfile, double startW, double endW, int n, int days) {
        User u = new User();
        if (withProfile) {
            Profile p = new Profile();
            p.setSex(Sex.MALE);
            p.setDateOfBirth(LocalDate.of(1995, 1, 1));
            p.setHeightCm(new BigDecimal("180"));
            p.setActivityLevel(ActivityLevel.MODERATE);
            u.setProfile(p);
        }
        List<BodyweightEntry> log = new ArrayList<>();
        Instant now = Instant.now();
        for (int i = 0; i < n; i++) {
            double frac = n == 1 ? 0 : i / (double) (n - 1);
            double w = startW + (endW - startW) * frac;
            Instant t = now.minus(Duration.ofSeconds((long) ((days * (1 - frac)) * 86_400)));
            log.add(new BodyweightEntry(java.util.UUID.randomUUID().toString(), t, BigDecimal.valueOf(w), false));
        }
        u.setBodyweightLog(log);
        if (n > 0) u.setCurrentBodyweightKg(BigDecimal.valueOf(endW));
        return u;
    }

    // NOTE (v2 ladder): the 2-state GATHERING_DATA/READY status was replaced by the 5-level ladder
    // INSUFFICIENT_DATA → TREND_ONLY → PHASE_LOW → PHASE_MED → PHASE_HIGH (docs/coach.md, energy council
    // 2026-07-21). Below-gate ⇒ INSUFFICIENT_DATA; a decisive fit ⇒ PHASE_*; a fit too noisy to even assert
    // MAINTENANCE ⇒ TREND_ONLY. Existing assertions are updated deliberately (acceptance criteria) — behaviour
    // that mattered (maintenance still shown below gate, phase sign, kcal band) is preserved.
    @Test
    void missingProfileAndNoData_gathersData() {
        EnergyDto e = svc.estimate(new User());
        assertThat(e.status()).isEqualTo("INSUFFICIENT_DATA");
        assertThat(e.missingProfile()).contains("sex", "dateOfBirth", "heightCm", "activityLevel");
        assertThat(e.maintenanceKcalLow()).isNull();
    }

    @Test
    void tooFewWeighIns_gathersData_butStillShowsMaintenance() {
        EnergyDto e = svc.estimate(user(true, 80, 80.5, 3, 5));   // 3 weigh-ins / 5 days < gate
        assertThat(e.status()).isEqualTo("INSUFFICIENT_DATA");
        assertThat(e.minWeighIns()).isEqualTo(6);
        assertThat(e.maintenanceKcalLow()).isNotNull();           // profile complete ⇒ Mifflin range available
        assertThat(e.maintenanceKcalLow()).isLessThan(e.maintenanceKcalHigh());
    }

    // M3 derive-at-read: with ZERO real weigh-ins the Mifflin weight falls back to the legacy import-era
    // mirror (routed through BodyweightMath.currentOf(u)) — pins the "behaviorally identical" refactor of
    // the n==0 branch, which no test exercised before.
    @Test
    void importOnlyAccount_mifflinFallsBackToLegacyMirror() {
        User u = new User();
        Profile p = new Profile();
        p.setSex(Sex.MALE);
        p.setDateOfBirth(LocalDate.of(1995, 1, 1));
        p.setHeightCm(new BigDecimal("180"));
        p.setActivityLevel(ActivityLevel.MODERATE);
        u.setProfile(p);
        // import shape: one estimated log row + the user-supplied real weight in the mirror
        u.setBodyweightLog(new ArrayList<>(List.of(new BodyweightEntry(
                java.util.UUID.randomUUID().toString(), Instant.now(), new BigDecimal("75.0"), true))));
        u.setCurrentBodyweightKg(new BigDecimal("75.0"));
        EnergyDto withMirror = svc.estimate(u);
        assertThat(withMirror.maintenanceKcalLow()).as("mirror fallback feeds Mifflin").isNotNull();

        u.setCurrentBodyweightKg(null);                           // mirror retired (post-first-write state)
        EnergyDto without = svc.estimate(u);
        assertThat(without.maintenanceKcalLow()).as("no weight at all ⇒ no maintenance range").isNull();
    }

    @Test
    void steadyGain_classifiesSurplus() {
        EnergyDto e = svc.estimate(user(true, 80.0, 81.6, 8, 28));  // +1.6 kg / 28 d ≈ +0.4 kg/wk
        assertThat(e.status()).startsWith("PHASE_");
        assertThat(e.phase()).isEqualTo("SURPLUS");
        assertThat(e.ratePerWeekKg()).startsWith("+0.4");
        assertThat(e.surplusDeficitKcalLow()).isGreaterThan(0);
    }

    @Test
    void steadyLoss_classifiesDeficit() {
        EnergyDto e = svc.estimate(user(true, 80.0, 78.4, 8, 28));  // −0.4 kg/wk
        assertThat(e.phase()).isEqualTo("DEFICIT");
        assertThat(e.surplusDeficitKcalHigh()).isLessThan(0);
    }

    @Test
    void flatWeight_classifiesMaintenance() {
        EnergyDto e = svc.estimate(user(true, 80.0, 80.0, 8, 28));
        assertThat(e.phase()).isEqualTo("MAINTENANCE");
    }

    @Test
    void maintenanceSuppressesTheDirectionalKcalRange() {
        EnergyDto e = svc.estimate(user(true, 80.0, 80.0, 8, 28));   // flat → maintenance
        assertThat(e.surplusDeficitKcalLow()).isNull();              // no decisive surplus/deficit → no range
        assertThat(e.surplusDeficitKcalHigh()).isNull();
    }

    @Test
    void noisySeriesYieldsLowConfidence() {
        User u = user(true, 80.0, 80.0, 2, 28);                      // profile only; overwrite the log with scatter
        List<BodyweightEntry> log = new ArrayList<>();
        Instant now = Instant.now();
        double[] ws = { 80, 82.5, 78.5, 81.5, 79, 82, 78.5, 81 };    // ±2 kg around a flat trend → wide slope CI
        for (int i = 0; i < ws.length; i++) {
            log.add(new BodyweightEntry(java.util.UUID.randomUUID().toString(),
                    now.minus(Duration.ofDays(28L - i * 4)), BigDecimal.valueOf(ws[i]), false));
        }
        u.setBodyweightLog(log);
        EnergyDto e = svc.estimate(u);
        // v2: a CI wider than 3× the dead-band is now TREND_ONLY (too noisy to even assert MAINTENANCE); the
        // underlying tier is still LOW. Previously this returned READY+LOW; the ladder makes the honesty explicit.
        assertThat(e.status()).isEqualTo("TREND_ONLY");
        assertThat(e.confidence()).isEqualTo("LOW");                 // CI wider than the trend → direction uncertain
        assertThat(e.phase()).isEqualTo("UNKNOWN");                  // no phase verdict emitted
        assertThat(e.surplusDeficitKcalLow()).isNull();
    }

    @Test
    void maleGateBoundary_sixWeighInsOverFourteenDays_isReady() {
        EnergyDto e = svc.estimate(user(true, 80.0, 80.8, 6, 14));
        assertThat(e.status()).startsWith("PHASE_");   // gate passed + decisive linear trend ⇒ a phase level
    }

    @Test
    void femaleNeedsLongerSpan() {
        User u = user(true, 80.0, 81.6, 8, 16);   // ok for male, below the 28-day female gate
        u.getProfile().setSex(Sex.FEMALE);
        assertThat(svc.estimate(u).status()).isEqualTo("INSUFFICIENT_DATA");
    }

    @Test
    void sameDayWeighIns_dontCrashOrFalselyClassify() {
        EnergyDto e = svc.estimate(user(true, 80.0, 80.0, 8, 0));   // zero span guard
        assertThat(e.status()).isEqualTo("INSUFFICIENT_DATA");
    }

    // ── E1: dead-band boundary. A weekly rate inside ±0.1%bw/wk classifies MAINTENANCE; just outside it
    //    classifies SURPLUS/DEFICIT. (Linear series ⇒ tight CI, so the boundary is the dead-band itself.) ──
    @Test
    void rateInsideDeadBand_isMaintenance_outsideIsDecisive() {
        // 80 kg ⇒ dead-band ≈ ±0.08 kg/wk. +0.04 kg/wk is inside; +0.12 kg/wk is outside.
        assertThat(svc.estimate(user(true, 80.0, 80.16, 8, 28)).phase()).isEqualTo("MAINTENANCE"); // +0.04/wk
        assertThat(svc.estimate(user(true, 80.0, 80.48, 8, 28)).phase()).isEqualTo("SURPLUS");     // +0.12/wk
        assertThat(svc.estimate(user(true, 80.0, 79.52, 8, 28)).phase()).isEqualTo("DEFICIT");     // −0.12/wk
    }

    @Test
    void positiveMeanButWideCiStraddlingTheBand_isMaintenance() {
        User u = user(true, 80.0, 80.0, 2, 28);
        List<BodyweightEntry> log = new ArrayList<>();
        Instant now = Instant.now();
        double[] ws = { 79.0, 82.0, 79.5, 81.5, 80.0, 82.5, 80.5, 82.0 };   // gently up but very scattered
        for (int i = 0; i < ws.length; i++)
            log.add(new BodyweightEntry(java.util.UUID.randomUUID().toString(),
                    now.minus(Duration.ofDays(28L - i * 4)), BigDecimal.valueOf(ws[i]), false));
        u.setBodyweightLog(log);
        EnergyDto e = svc.estimate(u);
        // v2: a positive mean with a CI this wide is beyond 3× the dead-band ⇒ TREND_ONLY (we can't even assert
        // MAINTENANCE), which is stricter/honester than the v1 "default to MAINTENANCE". Either way it never
        // reaches PHASE_HIGH, so the planner sees no clamp — the downstream contract is unchanged.
        assertThat(e.status()).isEqualTo("TREND_ONLY");
        assertThat(e.phase()).isEqualTo("UNKNOWN");
    }

    // ── E2: estimated and null-weight weigh-ins are excluded from both the count and the slope fit. ──
    @Test
    void estimatedAndNullWeighInsAreExcluded() {
        User u = user(true, 80.0, 80.0, 6, 28);   // 6 REAL, flat ⇒ READY + MAINTENANCE
        Instant now = Instant.now();
        u.getBodyweightLog().add(new BodyweightEntry("est1", now, BigDecimal.valueOf(120.0), true));   // estimated, huge
        u.getBodyweightLog().add(new BodyweightEntry("est2", now.minus(Duration.ofDays(3)), BigDecimal.valueOf(40.0), true));
        u.getBodyweightLog().add(new BodyweightEntry("nullw", now.minus(Duration.ofDays(1)), null, false));
        EnergyDto e = svc.estimate(u);
        assertThat(e.weighIns()).isEqualTo(6);            // only the real ones count
        assertThat(e.phase()).isEqualTo("MAINTENANCE");   // the wild estimated points don't move the slope
    }

    // ── E4: sign coherence — a decisive phase agrees with the rate sign and the kcal band is ordered. ──
    @Test
    void decisivePhaseHasCoherentSignsAndOrderedBand() {
        EnergyDto s = svc.estimate(user(true, 80.0, 81.6, 8, 28));   // surplus
        assertThat(s.ratePerWeekKg()).startsWith("+");
        assertThat(s.surplusDeficitKcalLow()).isGreaterThan(0);
        assertThat(s.surplusDeficitKcalLow()).isLessThanOrEqualTo(s.surplusDeficitKcalHigh());
        EnergyDto d = svc.estimate(user(true, 80.0, 78.4, 8, 28));   // deficit
        assertThat(d.ratePerWeekKg()).startsWith("-");
        assertThat(d.surplusDeficitKcalHigh()).isLessThan(0);
        assertThat(d.surplusDeficitKcalLow()).isLessThanOrEqualTo(d.surplusDeficitKcalHigh());
    }

    // ── E6: Mifflin × PAL — maintenance rises with activity level, and with the sex offset MALE>UNSPEC>FEMALE. ──
    private User profiled(Sex sex, ActivityLevel a) {
        User u = user(true, 80.0, 80.0, 1, 0);   // profile + one weigh-in ⇒ maintenance computed (gate aside)
        u.getProfile().setSex(sex);
        u.getProfile().setActivityLevel(a);
        return u;
    }

    @Test
    void maintenanceRisesWithActivityLevel() {
        int prev = Integer.MIN_VALUE;
        for (ActivityLevel a : ActivityLevel.values()) {
            int high = svc.estimate(profiled(Sex.MALE, a)).maintenanceKcalHigh();
            assertThat(high).isGreaterThan(prev);
            prev = high;
        }
    }

    @Test
    void sexOffsetOrdersMaintenanceMaleOverUnspecifiedOverFemale() {
        int male = svc.estimate(profiled(Sex.MALE, ActivityLevel.MODERATE)).maintenanceKcalHigh();
        int unspec = svc.estimate(profiled(Sex.UNSPECIFIED, ActivityLevel.MODERATE)).maintenanceKcalHigh();
        int female = svc.estimate(profiled(Sex.FEMALE, ActivityLevel.MODERATE)).maintenanceKcalHigh();
        assertThat(male).isGreaterThan(unspec);
        assertThat(unspec).isGreaterThan(female);
    }

    // ── E7: the weekly rate is formatted as a signed, 2-dp, US-locale (dot) decimal. ──
    @Test
    void ratePerWeekIsSignedTwoDecimalUsFormat() {
        EnergyDto e = svc.estimate(user(true, 80.0, 81.6, 8, 28));
        assertThat(e.ratePerWeekKg()).matches("^[+-]\\d+\\.\\d{2}$");
    }

    // ── D4: the CI half-width uses a small-sample Student-t multiplier (df = n−2), not a fixed z=1.96, so
    //    small samples aren't called more decisively than the data warrants. ──
    @Test
    void usesSmallSampleTMultiplierNotZ() {
        assertThat(EnergyService.tMultiplier(4)).isEqualTo(2.776);   // n=6 (df=4): t, well above z
        assertThat(EnergyService.tMultiplier(6)).isGreaterThan(1.96);
        assertThat(EnergyService.tMultiplier(100)).isEqualTo(1.96);  // large n → normal approximation
    }

    // ═══ v2 energy-model upgrade (docs/coach.md "Energy model"; energy council 2026-07-21). ═══
    // Estimator: Theil–Sen slope (robust + unbiased) + honest raw-residual CI + EWMA dead-band anchor +
    // 5-level ladder. Theil–Sen deliberately replaces the council's literal "OLS on the EWMA-smoothed series",
    // which empirically attenuated a clean slope ~38% and inflated its CI — see docs/eval-findings.md.

    // Helper: a flat series with an alternating ±amp scatter (Theil–Sen slope ≈ 0, controllable CI width).
    private User flatScatter(double base, double amp, int n, int days) {
        User u = user(true, base, base, 1, 0);
        List<BodyweightEntry> log = new ArrayList<>();
        Instant now = Instant.now();
        for (int i = 0; i < n; i++) {
            double w = base + (i % 2 == 0 ? -amp : amp);
            long ago = (long) ((days * (1 - i / (double) (n - 1))) * 86_400);
            log.add(new BodyweightEntry(java.util.UUID.randomUUID().toString(),
                    now.minus(Duration.ofSeconds(ago)), BigDecimal.valueOf(w), false));
        }
        u.setBodyweightLog(log);
        return u;
    }

    // ── E8: FEMALE gate needs ≥28 days (was 21). 6 real weigh-ins over 24 days: female stays gathering,
    //    a male at the same span classifies. (Existing femaleNeedsLongerSpan @16d fails under both 21 and 28.) ──
    @Test
    void femaleGateIsTwentyEightDays() {
        User f = user(true, 80.0, 80.8, 6, 24);
        f.getProfile().setSex(Sex.FEMALE);
        assertThat(svc.estimate(f).status()).isEqualTo("INSUFFICIENT_DATA");   // 24 < 28
        User m = user(true, 80.0, 80.8, 6, 24);                                // same span, male
        assertThat(svc.estimate(m).status()).startsWith("PHASE_");             // 24 ≥ 14
    }

    // ── E9: the UNSPECIFIED Mifflin offset is the exact arithmetic midpoint of male(+5)/female(−161) = −78. ──
    @Test
    void unspecifiedOffsetIsMidpointOfMaleAndFemale() {
        assertThat(EnergyModel.SEX_OFFSET_UNSPECIFIED).isEqualTo(-78.0);
        assertThat(EnergyModel.SEX_OFFSET_UNSPECIFIED)
                .isEqualTo((EnergyModel.SEX_OFFSET_MALE + EnergyModel.SEX_OFFSET_FEMALE) / 2.0);
    }

    // ── E10: maintenance display half-range is ±12% for UNSPECIFIED sex, ±8% for MALE/FEMALE. The full-width
    //    fraction (high−low)/(high+low) equals the half-range independent of TDEE, so it's robust to rounding. ──
    @Test
    void unspecifiedSexWidensMaintenanceRange() {
        assertThat(EnergyModel.MAINT_HALF_RANGE).isEqualTo(0.08);
        assertThat(EnergyModel.MAINT_HALF_RANGE_UNSPECIFIED).isEqualTo(0.12);
        EnergyDto male = svc.estimate(profiled(Sex.MALE, ActivityLevel.MODERATE));
        EnergyDto unspec = svc.estimate(profiled(Sex.UNSPECIFIED, ActivityLevel.MODERATE));
        double maleFrac = frac(male), unspecFrac = frac(unspec);
        assertThat(maleFrac).isCloseTo(0.08, org.assertj.core.data.Offset.offset(0.02));
        assertThat(unspecFrac).isCloseTo(0.12, org.assertj.core.data.Offset.offset(0.02));
        assertThat(unspecFrac).isGreaterThan(maleFrac);
    }
    private static double frac(EnergyDto e) {
        return (e.maintenanceKcalHigh() - e.maintenanceKcalLow())
                / (double) (e.maintenanceKcalHigh() + e.maintenanceKcalLow());
    }

    // ── E11: the 5-level ladder. A CI wider than 3× the dead-band ⇒ TREND_ONLY (no phase verdict, null
    //    surplus/deficit); a tight decisive trend at the same weight ⇒ a PHASE_* level with a real phase. ──
    @Test
    void ladderTrendOnlyWhenCiExceedsThreeDeadbands() {
        EnergyDto wide = svc.estimate(flatScatter(80.0, 1.5, 8, 28));   // huge scatter ⇒ CI ≫ 3·deadband
        assertThat(wide.status()).isEqualTo("TREND_ONLY");
        assertThat(wide.phase()).isEqualTo("UNKNOWN");
        assertThat(wide.surplusDeficitKcalLow()).isNull();
        assertThat(wide.surplusDeficitKcalHigh()).isNull();

        EnergyDto tight = svc.estimate(user(true, 80.0, 81.6, 8, 28));  // clean +0.4/wk ⇒ decisive phase
        assertThat(tight.status()).startsWith("PHASE_");
        assertThat(tight.phase()).isEqualTo("SURPLUS");
    }

    // ── E12: the gate is denominated in ciWk (t-inflated), NOT the raw slope SE. This 8-point series has a raw
    //    weekly SE well BELOW 3·deadband (a raw-SE gate would classify it), but the small-sample Student-t
    //    multiplier (df=6, t≈2.447) inflates the CI past 3·deadband ⇒ TREND_ONLY. Proves t is in the gate. ──
    @Test
    void gateIsDenominatedInCiNotRawSe() {
        EnergyDto e = svc.estimate(flatScatter(80.0, 0.55, 8, 28));
        assertThat(e.status()).isEqualTo("TREND_ONLY");   // raw se·7≈0.17 < 3·db≈0.24, but t·se·7≈0.42 > 0.24
    }

    // ── E13: confidence-tier regression-lock (formula unchanged, lines 115-116). A clean trend over a long span
    //    (≥ minSpan+7) is PHASE_HIGH; the same clean trend over exactly the min span is PHASE_MED (span floor);
    //    a near-flat trend whose CI straddles the band at 2–3× width is PHASE_LOW (always a MAINTENANCE, never a
    //    decisive direction — a decisive phase is at least MEDIUM). ──
    @Test
    void confidenceTierBoundariesUnchanged() {
        assertThat(svc.estimate(user(true, 80.0, 81.6, 8, 28)).status()).isEqualTo("PHASE_HIGH");    // span 28 ≥ 21
        assertThat(svc.estimate(user(true, 80.0, 80.8, 6, 14)).status()).isEqualTo("PHASE_MEDIUM");  // span 14 < 21
        EnergyDto low = svc.estimate(flatScatter(80.0, 0.26, 8, 28));                                // 2·db < ciWk ≤ 3·db
        assertThat(low.status()).isEqualTo("PHASE_LOW");
        assertThat(low.phase()).isEqualTo("MAINTENANCE");   // PHASE_LOW only ever accompanies a MAINTENANCE verdict
    }

    // ── E21: a DECISIVE but noisy fast trend must still classify — the TREND_ONLY gate only fires on a CI that
    //    STRADDLES the dead-band, never on a wide one-sided CI. A real −1.0 kg/wk cut with ±0.35 kg scale scatter
    //    has its whole CI below −dead-band ⇒ PHASE_HIGH DEFICIT (feeds the planner clamp), NOT TREND_ONLY.
    //    (Regression guard for the review-council finding: an absolute ciWk gate suppressed exactly these users.) ──
    @Test
    void decisiveButNoisyFastTrendStillClassifies() {
        User u = user(true, 80.0, 80.0, 2, 28);
        List<BodyweightEntry> log = new ArrayList<>();
        Instant now = Instant.now();
        for (int i = 0; i < 8; i++) {
            double w = 80.0 - 1.0 * (i * 4 / 7.0) + (i % 2 == 1 ? 0.35 : -0.35);   // −1.0 kg/wk + ±0.35 zigzag
            log.add(new BodyweightEntry(java.util.UUID.randomUUID().toString(),
                    now.minus(Duration.ofDays(28L - i * 4)), BigDecimal.valueOf(w), false));
        }
        u.setBodyweightLog(log);
        EnergyDto e = svc.estimate(u);
        assertThat(e.status()).isEqualTo("PHASE_HIGH");
        assertThat(e.phase()).isEqualTo("DEFICIT");
        assertThat(e.surplusDeficitKcalHigh()).isLessThan(0);
    }

    // ── E14: EWMA/Theil–Sen robustness — one raw weigh-in several kg off-trend cannot flip the phase nor move
    //    the reported rate. A −5 kg outlier on a decisive surplus flips plain OLS to a false DEFICIT (−0.11/wk);
    //    Theil–Sen holds the rate at +0.40 and the honest CI widens to TREND_ONLY ("can't tell"), never DEFICIT. ──
    @Test
    void singleWildWeighInCannotFlipPhaseOrMoveRate() {
        EnergyDto base = svc.estimate(user(true, 80.0, 81.6, 8, 28));
        assertThat(base.phase()).isEqualTo("SURPLUS");
        User u = user(true, 80.0, 81.6, 8, 28);
        List<BodyweightEntry> log = new ArrayList<>(u.getBodyweightLog());
        Instant last = log.get(log.size() - 1).recordedAt();
        log.add(new BodyweightEntry("wild", last.plus(Duration.ofHours(6)),
                BigDecimal.valueOf(76.6), false));   // −5 kg off-trend, newest point (max OLS leverage)
        u.setBodyweightLog(log);
        EnergyDto e = svc.estimate(u);
        // The outlier can't move the Theil–Sen rate, but it balloons the raw-residual CI into a straddle ⇒ the
        // verdict drops to TREND_ONLY (fails SAFE — removes the planner clamp, never manufactures a wrong phase).
        assertThat(e.status()).isEqualTo("TREND_ONLY");
        assertThat(e.phase()).isNotEqualTo("DEFICIT");        // never a wrong decisive verdict
        assertThat(e.ratePerWeekKg()).startsWith("+0.4");     // Theil–Sen rate unmoved by the outlier
        assertThat(e.modelVersion()).isEqualTo(EnergyModel.MODEL_VERSION);   // stamped on the TREND_ONLY path too
    }

    // ── E15: the EWMA is time-decayed. The same fresh reading after a long gap is weighted MORE (older info has
    //    decayed) than after a short gap — so a high new point pulls the smoothed estimate further after a gap. ──
    @Test
    void ewmaIsTimeDecayedForIrregularCadence() {
        double a = EnergyModel.EWMA_ALPHA;
        double afterOneDay = EnergyService.ewma(new double[]{0, 1}, new double[]{80, 90}, a)[1];
        double afterThirtyDays = EnergyService.ewma(new double[]{0, 30}, new double[]{80, 90}, a)[1];
        assertThat(afterThirtyDays).isGreaterThan(afterOneDay);   // long gap ⇒ new point dominates
        assertThat(afterOneDay).isLessThan(81.0);                 // short gap ⇒ barely moves off 80
    }

    // ── E16: honest SE from RAW scatter. A big zigzag around a rising trend has a clear Theil–Sen slope but
    //    large raw residuals ⇒ the CI must be wide (never HIGH confidence) — smoothed residuals are not used. ──
    @Test
    void ciReflectsRawScatterNotASmoothedFit() {
        User u = user(true, 80.0, 80.0, 2, 28);
        List<BodyweightEntry> log = new ArrayList<>();
        Instant now = Instant.now();
        for (int i = 0; i < 8; i++) {
            double w = 80 + 0.4 * i / 7.0 + (i % 2 == 0 ? -3 : 3);   // ±3 kg zigzag on a gentle rise
            log.add(new BodyweightEntry(java.util.UUID.randomUUID().toString(),
                    now.minus(Duration.ofDays(28L - i * 4)), BigDecimal.valueOf(w), false));
        }
        u.setBodyweightLog(log);
        assertThat(svc.estimate(u).status()).isNotEqualTo("PHASE_HIGH");
    }

    // ── E17: the workout-energy term is display-only and purely additive. Passing a session count sets
    //    workoutKcal but leaves phase, confidence, surplus/deficit AND maintenance byte-identical; 0 sessions
    //    ⇒ null workoutKcal (PAL-only output identical to the pre-workout-term model). ──
    @Test
    void workoutTermIsDisplayOnlyAndAdditive() {
        User u = user(true, 80.0, 81.6, 8, 28);
        EnergyDto e0 = svc.estimate(u, 0);
        EnergyDto e4 = svc.estimate(u, 4);
        assertThat(e0.workoutKcal()).isNull();
        assertThat(e4.workoutKcal()).isEqualTo(200);   // round50(4·350/7) = round50(200)
        assertThat(e4.phase()).isEqualTo(e0.phase());
        assertThat(e4.confidence()).isEqualTo(e0.confidence());
        assertThat(e4.status()).isEqualTo(e0.status());
        assertThat(e4.surplusDeficitKcalLow()).isEqualTo(e0.surplusDeficitKcalLow());
        assertThat(e4.surplusDeficitKcalHigh()).isEqualTo(e0.surplusDeficitKcalHigh());
        assertThat(e4.maintenanceKcalLow()).isEqualTo(e0.maintenanceKcalLow());
        assertThat(e4.maintenanceKcalHigh()).isEqualTo(e0.maintenanceKcalHigh());
        assertThat(e4.neatBmrKcal()).isEqualTo(e0.neatBmrKcal());
    }

    // ── E18: the PAL constants are NOT silently rescaled when the workout term ships. ──
    @Test
    void palConstantsUnchanged() {
        assertThat(EnergyModel.PAL).containsExactly(1.40, 1.55, 1.70, 1.85, 2.00);
    }

    // ── E19: every estimate carries the non-null model version, whatever the ladder level. ──
    @Test
    void everyEstimateCarriesModelVersion() {
        assertThat(svc.estimate(new User()).modelVersion()).isEqualTo(EnergyModel.MODEL_VERSION);
        assertThat(svc.estimate(user(true, 80.0, 81.6, 8, 28)).modelVersion()).isEqualTo(EnergyModel.MODEL_VERSION);
        assertThat(EnergyModel.MODEL_VERSION).isGreaterThan(0);
    }

    // ── E20: the dead-band anchor is the LATEST EWMA-smoothed weight — noise-robust AND current: for a trending
    //    series it sits between the (stale, backward-looking) mean and the raw latest, closer to the latest. ──
    @Test
    void deadbandAnchorIsLatestEwmaNotMeanNorRawLatest() {
        double[] x = new double[8], y = new double[8];
        for (int i = 0; i < 8; i++) { x[i] = 4 * i; y[i] = 80 + 6.0 * i / 7.0; }   // 80 → 86, clear uptrend
        double anchor = EnergyService.ewma(x, y, EnergyModel.EWMA_ALPHA)[7];
        double mean = 83.0, rawLatest = 86.0;
        assertThat(anchor).isNotEqualTo(mean).isNotEqualTo(rawLatest);
        assertThat(Math.abs(anchor - rawLatest)).isLessThan(Math.abs(mean - rawLatest));   // more current than the mean
    }
}
