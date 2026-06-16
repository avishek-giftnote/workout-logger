package com.workoutlogger.coach;

import com.workoutlogger.domain.ActivityLevel;
import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.Profile;
import com.workoutlogger.domain.Sex;
import com.workoutlogger.domain.User;
import com.workoutlogger.web.dto.ApiDtos.EnergyDto;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Read-time energy-balance estimate from the user's profile + real (non-estimated) weigh-ins.
 * Pure function — nothing is persisted. Slope of bodyweight is the source of truth for surplus/deficit;
 * Mifflin–St Jeor × PAL gives a rough maintenance. Phase is classified from the CONFIDENCE INTERVAL of
 * the weekly rate with a ±0.1%-bodyweight/week dead-band, behind a hard data-sufficiency gate.
 * See docs/coach.md. NOT medical advice.
 */
@Service
public class EnergyService {

    private static final double[] PAL = {1.40, 1.55, 1.70, 1.85, 2.00};   // by ActivityLevel.ordinal()
    private static final double KCAL_PER_KG = 7700.0;

    // Two-sided 95% Student-t critical value by degrees of freedom (index = df). At small n the slope's
    // sampling distribution is t, not normal: z=1.96 understates the CI ~30% at n=6 (df=4, t≈2.78) and would
    // make phase / HIGH-confidence calls more decisive than the data warrants. Falls back to ~1.96 for df≥30.
    private static final double[] T95 = {
            Double.NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
            2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
            2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
    };
    static double tMultiplier(int df) {   // package-visible so the energy test can pin the table (D4)
        if (df <= 0) return T95[1];
        return df < T95.length ? T95[df] : 1.96;
    }

    public EnergyDto estimate(User u) {
        Profile p = u.getProfile();
        List<String> missing = new ArrayList<>();
        if (p == null || p.getSex() == null) missing.add("sex");
        if (p == null || p.getDateOfBirth() == null) missing.add("dateOfBirth");
        if (p == null || p.getHeightCm() == null) missing.add("heightCm");
        if (p == null || p.getActivityLevel() == null) missing.add("activityLevel");
        boolean hasProfile = missing.isEmpty();

        List<BodyweightEntry> entries = u.getBodyweightLog().stream()
                .filter(e -> !e.estimated() && e.weightKg() != null)
                .sorted(Comparator.comparing(BodyweightEntry::recordedAt))
                .toList();
        int n = entries.size();
        long spanDays = n >= 2 ? Duration.between(entries.get(0).recordedAt(), entries.get(n - 1).recordedAt()).toDays() : 0;
        boolean female = hasProfile && p.getSex() == Sex.FEMALE;
        int minN = 6;
        int minSpan = female ? 21 : 14;   // wider window for cyclic water retention

        BigDecimal latestW = n > 0 ? entries.get(n - 1).weightKg() : u.getCurrentBodyweightKg();

        // Mifflin–St Jeor × PAL maintenance range (±8%), only with a complete profile + a weight.
        Integer maintLow = null, maintHigh = null;
        if (hasProfile && latestW != null) {
            double w = latestW.doubleValue();
            double h = p.getHeightCm().doubleValue();
            double age = Period.between(p.getDateOfBirth(), LocalDate.now()).getYears();
            double s = switch (p.getSex()) { case MALE -> 5; case FEMALE -> -161; default -> -78; };
            double bmr = 10 * w + 6.25 * h - 5 * age + s;
            double tdee = bmr * PAL[indexOf(p.getActivityLevel())];
            maintLow = round50(tdee * 0.92);
            maintHigh = round50(tdee * 1.08);
        }

        if (n < minN || spanDays < minSpan) {
            return new EnergyDto("GATHERING_DATA", "UNKNOWN", "NONE", n, (int) spanDays, minN, minSpan,
                    null, maintLow, maintHigh, null, null, missing);
        }

        // Least-squares slope of weight (kg/day) over the real series + standard error.
        Instant t0 = entries.get(0).recordedAt();
        double[] xs = new double[n], ys = new double[n];
        for (int i = 0; i < n; i++) {
            xs[i] = Duration.between(t0, entries.get(i).recordedAt()).toSeconds() / 86_400.0;
            ys[i] = entries.get(i).weightKg().doubleValue();
        }
        double xbar = mean(xs), ybar = mean(ys), sxx = 0, sxy = 0;
        for (int i = 0; i < n; i++) { sxx += (xs[i] - xbar) * (xs[i] - xbar); sxy += (xs[i] - xbar) * (ys[i] - ybar); }
        if (sxx <= 0) {   // all weigh-ins effectively same instant
            return new EnergyDto("GATHERING_DATA", "UNKNOWN", "NONE", n, (int) spanDays, minN, minSpan,
                    null, maintLow, maintHigh, null, null, missing);
        }
        double slope = sxy / sxx;                 // kg/day
        double intercept = ybar - slope * xbar;
        double sse = 0;
        for (int i = 0; i < n; i++) { double r = ys[i] - (intercept + slope * xs[i]); sse += r * r; }
        double se = Math.sqrt((sse / Math.max(1, n - 2)) / sxx);   // SE of slope (kg/day)

        double rateWk = slope * 7, ciWk = tMultiplier(n - 2) * se * 7;   // weekly rate + 95% CI half-width (t, not z)
        double deadband = 0.001 * ybar;                            // 0.1% of the regression-central weight / week
        double lo = rateWk - ciWk, hi = rateWk + ciWk;
        String phase = lo > deadband ? "SURPLUS" : hi < -deadband ? "DEFICIT" : "MAINTENANCE";

        // Confidence from how tightly the weekly rate is pinned (CI half-width) vs the dead-band / rate,
        // with a sex-aware span floor. LOW when the CI is wider than the trend itself (direction uncertain).
        String confidence;
        if (ciWk <= Math.max(deadband, 0.5 * Math.abs(rateWk)) && spanDays >= minSpan + 7) confidence = "HIGH";
        else if (ciWk <= Math.max(2 * deadband, Math.abs(rateWk))) confidence = "MEDIUM";
        else confidence = "LOW";

        // Surplus/deficit kcal/day from the slope (range from the CI) — only meaningful with a decisive phase.
        boolean decisive = !"MAINTENANCE".equals(phase);
        double sdMid = slope * KCAL_PER_KG, sdCi = (ciWk / 7) * KCAL_PER_KG;
        Integer sdLow = decisive ? round50(sdMid - sdCi) : null;
        Integer sdHigh = decisive ? round50(sdMid + sdCi) : null;
        String rateStr = String.format(Locale.US, "%+.2f", rateWk);

        return new EnergyDto("READY", phase, confidence, n, (int) spanDays, minN, minSpan,
                rateStr, maintLow, maintHigh, sdLow, sdHigh, missing);
    }

    private static int indexOf(ActivityLevel a) { return Math.min(PAL.length - 1, a.ordinal()); }
    private static double mean(double[] v) { double s = 0; for (double x : v) s += x; return s / v.length; }
    private static int round50(double v) { return (int) (Math.round(v / 50.0) * 50); }
}
