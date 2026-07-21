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
 * Read-time energy-balance estimate from the user's profile + real (non-estimated) weigh-ins. Pure function —
 * nothing is persisted (derive-on-read, docs/coach.md Principle 4). The bodyweight SLOPE is the source of truth
 * for surplus/deficit; Mifflin–St Jeor × PAL gives a rough maintenance and a decomposed BMR/NEAT + separate
 * (display-only) workout term.
 *
 * <p>Trend robustness (v2): the slope is a <b>Theil–Sen</b> estimate (median of pairwise slopes) on the RAW
 * weigh-ins — unbiased for a linear trend and robust, so a single wild reading can't move the reported rate
 * (it corrupts only O(n) of the O(n²) pairwise slopes). The confidence interval is a conservative proxy from
 * the RAW residual scatter about that robust line (df = n−2 on the real weigh-in count, small-sample Student-t);
 * a lone outlier can only <i>widen</i> the CI (dropping the verdict to TREND_ONLY), never manufacture a wrong
 * decisive phase. The EWMA (time-decayed, ~10-day half-life) is used ONLY for the dead-band anchor (the latest
 * smoothed weight) + trend display, NOT for the slope. Phase is classified from the CI of the weekly rate
 * against a ±0.1%-bodyweight/week dead-band, behind a hard data-sufficiency gate. The status ladder is
 * INSUFFICIENT_DATA → TREND_ONLY → PHASE_LOW → PHASE_MEDIUM → PHASE_HIGH; only PHASE_HIGH (a HIGH-confidence
 * measured phase) feeds the planner clamp. (Theil–Sen deliberately replaces the design's OLS-on-smoothed slope,
 * which attenuated clean trends ~38% on short windows — see docs/eval-findings.md.)
 *
 * <p>All tunables live in {@link EnergyModel} and every estimate carries its {@code modelVersion}.
 * NOT medical advice.
 */
@Service
public class EnergyService {

    // Two-sided 95% Student-t critical value by degrees of freedom (index = df). At small n the slope's
    // sampling distribution is t, not normal: z=1.96 understates the CI ~30% at n=6 (df=4, t≈2.78) and would
    // make phase / HIGH-confidence calls more decisive than the data warrants. Falls back to ~1.96 for df≥30.
    private static final double[] T95 = {
            Double.NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
            2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
            2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
            2.040, 2.037, 2.035, 2.032, 2.030, 2.028, 2.026, 2.024, 2.023, 2.021,   // df 31–40 (smooth the cliff toward 1.96)
    };
    static double tMultiplier(int df) {   // package-visible so the energy test can pin the table (D4)
        if (df <= 0) return T95[1];
        return df < T95.length ? T95[df] : 1.96;   // df ≥ 41 → normal approximation (t₄₀≈2.021, close to 1.96)
    }

    /** Legacy 1-arg entry point — no trailing-window training data ⇒ no workout term (PAL-only, unchanged). */
    public EnergyDto estimate(User u) {
        return estimate(u, 0);
    }

    /**
     * @param recentSessionCount the tenant's sessions in the trailing 7 days (resolved by the caller so this
     *        service stays repository-free/pure). Drives ONLY the display-only workout-energy term — never the
     *        phase, confidence, or surplus/deficit. 0 ⇒ output is byte-identical to the pre-workout-term model.
     */
    public EnergyDto estimate(User u, int recentSessionCount) {
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
        int minN = EnergyModel.MIN_WEIGH_INS;
        int minSpan = female ? EnergyModel.MIN_SPAN_DAYS_FEMALE : EnergyModel.MIN_SPAN_DAYS;   // ≥1 cycle for cyclic water retention
        double alpha = female ? EnergyModel.EWMA_ALPHA_FEMALE : EnergyModel.EWMA_ALPHA;        // slower decay / wider window for females
        double deadbandFraction = female ? EnergyModel.DEADBAND_FRACTION_FEMALE : EnergyModel.DEADBAND_FRACTION;

        // n==0 ⇒ the derived current is null too, so this is the same legacy-mirror fallback as before —
        // routed through BodyweightMath so the derivation rule lives in one place (M3 derive-at-read).
        BigDecimal latestW = n > 0 ? entries.get(n - 1).weightKg() : com.workoutlogger.domain.BodyweightMath.currentOf(u);

        // Mifflin–St Jeor × PAL maintenance, only with a complete profile + a weight. Display half-range widens
        // for UNSPECIFIED sex (extra sex-attribution uncertainty on top of the model error). neatBmrKcal is the
        // BMR×PAL midpoint; workoutKcal is a SEPARATE additive display term (never folded into maintenance).
        Integer maintLow = null, maintHigh = null, neatBmrKcal = null;
        if (hasProfile && latestW != null) {
            double w = latestW.doubleValue();
            double h = p.getHeightCm().doubleValue();
            double age = Period.between(p.getDateOfBirth(), LocalDate.now()).getYears();
            double s = switch (p.getSex()) {
                case MALE -> EnergyModel.SEX_OFFSET_MALE;
                case FEMALE -> EnergyModel.SEX_OFFSET_FEMALE;
                default -> EnergyModel.SEX_OFFSET_UNSPECIFIED;   // (5 + −161)/2 = −78, the midpoint of the two sexes
            };
            double bmr = 10 * w + 6.25 * h - 5 * age + s;
            double tdee = bmr * EnergyModel.PAL[indexOf(p.getActivityLevel())];
            double half = p.getSex() == Sex.UNSPECIFIED ? EnergyModel.MAINT_HALF_RANGE_UNSPECIFIED : EnergyModel.MAINT_HALF_RANGE;
            maintLow = round50(tdee * (1 - half));
            maintHigh = round50(tdee * (1 + half));
            neatBmrKcal = round50(tdee);
        }
        // Display-only average daily training expenditure from trailing-7-day frequency. Independent of the fit;
        // 0 sessions ⇒ null so the PAL-only output is byte-identical to the pre-workout-term model (E18).
        Integer workoutKcal = recentSessionCount > 0
                ? round50(recentSessionCount * EnergyModel.KCAL_PER_SESSION / 7.0) : null;

        if (n < minN || spanDays < minSpan) {
            return gathering(n, spanDays, minN, minSpan, maintLow, maintHigh, neatBmrKcal, workoutKcal, missing);
        }

        // ── EWMA (time-decayed, ~10-day half-life) over the real series → the dead-band ANCHOR + trend display. ──
        Instant t0 = entries.get(0).recordedAt();
        double[] xs = new double[n], ys = new double[n];
        for (int i = 0; i < n; i++) {
            xs[i] = Duration.between(t0, entries.get(i).recordedAt()).toSeconds() / 86_400.0;
            ys[i] = entries.get(i).weightKg().doubleValue();
        }
        double[] sm = ewma(xs, ys, alpha);

        double xbar = mean(xs), sxx = 0;
        for (int i = 0; i < n; i++) sxx += (xs[i] - xbar) * (xs[i] - xbar);
        if (sxx <= 0) {   // all weigh-ins effectively same instant
            return gathering(n, spanDays, minN, minSpan, maintLow, maintHigh, neatBmrKcal, workoutKcal, missing);
        }

        // Slope via Theil–Sen (median of pairwise slopes). This DELIBERATELY deviates from the council's literal
        // Q5 "OLS slope on the EWMA-smoothed series": that mechanism empirically attenuates a clean trend ~38% on
        // short windows (a forward EWMA lags a ramp) AND inflates its CI (raw residuals about the lagged line),
        // wrongly forcing a decisive trend into TREND_ONLY. Theil–Sen is unbiased for a linear trend, has ZERO
        // tunables (more faithful to the council's anti-false-precision stance than OLS-on-smoothed), and is the
        // robustness the whole EWMA exercise was reaching for: one wild weigh-in corrupts only O(n) of the O(n²)
        // pairwise slopes, so the median ignores it — a single reading can never move the rate or flip the phase.
        // The CI/SE is still honest RAW scatter about the robust line (council Q5 intent); df pinned to n (real
        // weigh-in count). The EWMA series is retained for the dead-band ANCHOR + trend display. See
        // docs/eval-findings.md for the evidence + the review-council flag.
        double slope = theilSen(xs, ys);                         // kg/day, robust + unbiased
        double intercept = medianResidual(xs, ys, slope);        // robust line the CI is measured about
        double sseRaw = 0;
        for (int i = 0; i < n; i++) { double r = ys[i] - (intercept + slope * xs[i]); sseRaw += r * r; }
        double se = Math.sqrt((sseRaw / Math.max(1, n - 2)) / sxx);   // SE of slope (kg/day) from raw scatter

        double rateWk = slope * 7, ciWk = tMultiplier(n - 2) * se * 7;   // weekly rate + 95% CI half-width (t, not z)
        double anchor = sm[n - 1];                                       // latest SMOOTHED weight (noise-robust + current)
        double deadband = deadbandFraction * anchor;                     // 0.1%/wk (0.2% female) of the anchor weight
        double lo = rateWk - ciWk, hi = rateWk + ciWk;
        // Snap a near-zero rate to positive zero so the display never shows a signed "-0.00".
        String rateStr = String.format(Locale.US, "%+.2f", Math.abs(rateWk) < 0.005 ? 0.0 : rateWk);

        // ── 5-level ladder. A decisive, ONE-SIDED CI (entirely above/below the dead-band) always classifies —
        //    however wide the CI, its direction is certain (a real cut/bulk with scale noise still reads
        //    DEFICIT/SURPLUS). TREND_ONLY is ONLY the STRADDLE case: the CI overlaps the dead-band (direction
        //    unclear) AND is wider than 3× the band, so we can't even confidently assert MAINTENANCE. ──
        String phase = lo > deadband ? "SURPLUS" : hi < -deadband ? "DEFICIT" : "MAINTENANCE";
        if ("MAINTENANCE".equals(phase) && ciWk > EnergyModel.SE_GATE_DEADBAND_MULT * deadband) {
            return new EnergyDto("TREND_ONLY", "UNKNOWN", "LOW", n, (int) spanDays, minN, minSpan,
                    rateStr, maintLow, maintHigh, null, null, missing,
                    EnergyModel.MODEL_VERSION, neatBmrKcal, workoutKcal);
        }

        // Confidence tier (UNCHANGED from v1 — regression-locked, E15): HIGH when the CI is tight vs the
        // dead-band/rate AND the span clears the floor + a week; LOW when the CI is wider than the trend itself.
        String confidence;
        if (ciWk <= Math.max(deadband, 0.5 * Math.abs(rateWk)) && spanDays >= minSpan + 7) confidence = "HIGH";
        else if (ciWk <= Math.max(2 * deadband, Math.abs(rateWk))) confidence = "MEDIUM";
        else confidence = "LOW";

        // Surplus/deficit kcal/day from the slope (range from the CI) — only meaningful with a decisive phase.
        boolean decisive = !"MAINTENANCE".equals(phase);
        double sdMid = slope * EnergyModel.KCAL_PER_KG, sdCi = (ciWk / 7) * EnergyModel.KCAL_PER_KG;
        Integer sdLow = decisive ? round50(sdMid - sdCi) : null;
        Integer sdHigh = decisive ? round50(sdMid + sdCi) : null;

        return new EnergyDto("PHASE_" + confidence, phase, confidence, n, (int) spanDays, minN, minSpan,
                rateStr, maintLow, maintHigh, sdLow, sdHigh, missing,
                EnergyModel.MODEL_VERSION, neatBmrKcal, workoutKcal);
    }

    private static EnergyDto gathering(int n, long spanDays, int minN, int minSpan,
                                       Integer maintLow, Integer maintHigh, Integer neatBmrKcal,
                                       Integer workoutKcal, List<String> missing) {
        return new EnergyDto("INSUFFICIENT_DATA", "UNKNOWN", "NONE", n, (int) spanDays, minN, minSpan,
                null, maintLow, maintHigh, null, null, missing,
                EnergyModel.MODEL_VERSION, neatBmrKcal, workoutKcal);
    }

    private static int indexOf(ActivityLevel a) { return Math.min(EnergyModel.PAL.length - 1, a.ordinal()); }
    private static double mean(double[] v) { double s = 0; for (double x : v) s += x; return s / v.length; }
    private static int round50(double v) { return (int) (Math.round(v / 50.0) * 50); }

    /** Time-decayed EWMA (~10-day half-life at α≈0.067). The weight carried from the previous smoothed value is
     *  {@code exp(−α·Δt)}, so older info decays with the gap: a fresh reading after a long gap dominates, after a
     *  short gap barely moves the estimate — a single new weigh-in can never swing it. Package-visible so the
     *  test can pin the time-decay (E15) directly. sm[last] is the dead-band anchor (noise-robust + current). */
    static double[] ewma(double[] x, double[] y, double alpha) {
        int n = y.length;
        double[] s = new double[n];
        s[0] = y[0];
        for (int i = 1; i < n; i++) {
            double wDecay = Math.exp(-alpha * (x[i] - x[i - 1]));
            s[i] = wDecay * s[i - 1] + (1 - wDecay) * y[i];
        }
        return s;
    }

    /** Theil–Sen slope: the median of the slopes between every pair of points with distinct x. Robust
     *  (breakdown ~29%) and unbiased for a linear trend. n is a handful of weigh-ins, so O(n²) is trivial. */
    static double theilSen(double[] x, double[] y) {
        int n = x.length;
        double[] slopes = new double[n * (n - 1) / 2];
        int k = 0;
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++)
                if (x[j] != x[i]) slopes[k++] = (y[j] - y[i]) / (x[j] - x[i]);
        return k == 0 ? 0 : median(slopes, k);
    }

    /** The Theil–Sen intercept: median of (yᵢ − slope·xᵢ) — the robust line the residual scatter is measured about. */
    private static double medianResidual(double[] x, double[] y, double slope) {
        double[] r = new double[x.length];
        for (int i = 0; i < x.length; i++) r[i] = y[i] - slope * x[i];
        return median(r, r.length);
    }

    /** Median of the first {@code len} entries of {@code a} (a is reordered). */
    private static double median(double[] a, int len) {
        double[] c = java.util.Arrays.copyOf(a, len);
        java.util.Arrays.sort(c);
        int m = len / 2;
        return (len % 2 == 1) ? c[m] : (c[m - 1] + c[m]) / 2.0;
    }
}
