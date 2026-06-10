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

        double rateWk = slope * 7, ciWk = 1.96 * se * 7;           // weekly rate + 95% CI half-width
        double deadband = 0.001 * latestW.doubleValue();           // 0.1% bodyweight / week
        double lo = rateWk - ciWk, hi = rateWk + ciWk;
        String phase = lo > deadband ? "SURPLUS" : hi < -deadband ? "DEFICIT" : "MAINTENANCE";
        String confidence = (spanDays >= 21 && n >= 10) ? "HIGH" : "MEDIUM";

        // Surplus/deficit kcal/day from the slope (range from the CI). Straddles 0 when maintenance.
        double sdMid = slope * KCAL_PER_KG, sdCi = (ciWk / 7) * KCAL_PER_KG;
        Integer sdLow = round50(sdMid - sdCi), sdHigh = round50(sdMid + sdCi);
        String rateStr = String.format(Locale.US, "%+.2f", rateWk);

        return new EnergyDto("READY", phase, confidence, n, (int) spanDays, minN, minSpan,
                rateStr, maintLow, maintHigh, sdLow, sdHigh, missing);
    }

    private static int indexOf(ActivityLevel a) { return Math.min(PAL.length - 1, a.ordinal()); }
    private static double mean(double[] v) { double s = 0; for (double x : v) s += x; return s / v.length; }
    private static int round50(double v) { return (int) (Math.round(v / 50.0) * 50); }
}
