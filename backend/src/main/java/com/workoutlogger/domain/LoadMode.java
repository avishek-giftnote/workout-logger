package com.workoutlogger.domain;

/**
 * How a bodyweight-exercise set's load relates to bodyweight (DESIGN.md §5).
 * {@code weight} always stores the cumulative effective load; this + {@code loadDelta}
 * keep the decomposition recoverable. Null for external (non-bodyweight) exercises.
 */
public enum LoadMode {
    BODYWEIGHT,   // pure bodyweight: effective load == bodyweight, delta 0
    ADDED,        // weighted: effective load == bodyweight + delta
    ASSISTED      // assisted: effective load == bodyweight - delta
}
