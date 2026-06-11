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
}
