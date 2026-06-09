package com.workoutlogger.importer;

/** Importer reconciliation counts. Asserted against the verified expected values (DESIGN.md §4). */
public record Counts(int sets, int sessions, int exercises, int warmups, int bodyweightRows) {

    /** Verified expected totals for the 4 scoped templates. */
    public static final Counts EXPECTED = new Counts(1533, 47, 30, 195, 61);

    public String describe(Counts expected) {
        return String.format(
                "sets=%d/%d sessions=%d/%d exercises=%d/%d warmups=%d/%d bodyweightRows=%d/%d",
                sets, expected.sets, sessions, expected.sessions, exercises, expected.exercises,
                warmups, expected.warmups, bodyweightRows, expected.bodyweightRows);
    }
}
