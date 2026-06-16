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

    @Test
    void missingProfileAndNoData_gathersData() {
        EnergyDto e = svc.estimate(new User());
        assertThat(e.status()).isEqualTo("GATHERING_DATA");
        assertThat(e.missingProfile()).contains("sex", "dateOfBirth", "heightCm", "activityLevel");
        assertThat(e.maintenanceKcalLow()).isNull();
    }

    @Test
    void tooFewWeighIns_gathersData_butStillShowsMaintenance() {
        EnergyDto e = svc.estimate(user(true, 80, 80.5, 3, 5));   // 3 weigh-ins / 5 days < gate
        assertThat(e.status()).isEqualTo("GATHERING_DATA");
        assertThat(e.minWeighIns()).isEqualTo(6);
        assertThat(e.maintenanceKcalLow()).isNotNull();           // profile complete ⇒ Mifflin range available
        assertThat(e.maintenanceKcalLow()).isLessThan(e.maintenanceKcalHigh());
    }

    @Test
    void steadyGain_classifiesSurplus() {
        EnergyDto e = svc.estimate(user(true, 80.0, 81.6, 8, 28));  // +1.6 kg / 28 d ≈ +0.4 kg/wk
        assertThat(e.status()).isEqualTo("READY");
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
        assertThat(e.status()).isEqualTo("READY");
        assertThat(e.confidence()).isEqualTo("LOW");                 // CI wider than the trend → direction uncertain
    }

    @Test
    void maleGateBoundary_sixWeighInsOverFourteenDays_isReady() {
        EnergyDto e = svc.estimate(user(true, 80.0, 80.8, 6, 14));
        assertThat(e.status()).isEqualTo("READY");
    }

    @Test
    void femaleNeedsLongerSpan() {
        User u = user(true, 80.0, 81.6, 8, 16);   // ok for male, below the 21-day female gate
        u.getProfile().setSex(Sex.FEMALE);
        assertThat(svc.estimate(u).status()).isEqualTo("GATHERING_DATA");
    }

    @Test
    void sameDayWeighIns_dontCrashOrFalselyClassify() {
        EnergyDto e = svc.estimate(user(true, 80.0, 80.0, 8, 0));   // zero span guard
        assertThat(e.status()).isEqualTo("GATHERING_DATA");
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
        assertThat(e.status()).isEqualTo("READY");
        assertThat(e.phase()).isEqualTo("MAINTENANCE");   // CI straddles the band ⇒ direction undecided
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
}
