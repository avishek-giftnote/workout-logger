package com.workoutlogger.domain;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;

/**
 * Derives the user's current bodyweight from the log — the single source of truth for the value that
 * used to live in the stored {@code User.currentBodyweightKg} mirror (audit M3: a stored mirror cannot
 * be recomputed atomically alongside a targeted {@code $push}/{@code $pull}, so it is derived at read
 * time instead and the mirror is never written again).
 */
public final class BodyweightMath {

    private BodyweightMath() {}

    /** Latest NON-estimated entry's weight, else null — an estimated import value must never poison the
     *  bodyweight effective-load calc (DESIGN.md §5). */
    public static BigDecimal currentOf(List<BodyweightEntry> log) {
        return log.stream()
                .filter(e -> !e.estimated() && e.weightKg() != null && e.recordedAt() != null)
                .max(Comparator.comparing(BodyweightEntry::recordedAt))
                .map(BodyweightEntry::weightKg).orElse(null);
    }

    /**
     * Derived current, falling back to the stored legacy mirror when the log holds no real weigh-in.
     * The fallback exists for import-era accounts: the importer wrote a REAL user-supplied weight to the
     * mirror while logging only an estimated row, so a strict derive would null their bodyweight. It is
     * safe because the mirror is RETIRED on first touch — every bodyweight write in {@code MeRepository}
     * {@code $unset}s it in the same atomic update — so an account that has ever added/amended/deleted a
     * weigh-in is purely derived, and deleting the last real entry yields null rather than resurrecting a
     * years-stale import weight (the old recomputeCurrent lifecycle, reproduced without a stored mirror).
     */
    public static BigDecimal currentOf(User u) {
        BigDecimal derived = currentOf(u.getBodyweightLog());
        return derived != null ? derived : u.getCurrentBodyweightKg();
    }
}
