package com.workoutlogger.domain;

import java.util.List;

/**
 * One exercise performed within a session, embedded in a {@link Workout}.
 *
 * @param exerciseId reference to the {@link Exercise} catalog document (hex id).
 * @param name       exercise name snapshot at log time — an IMMUTABLE historical record
 *                   (catalog renames do NOT rewrite this; current display name resolves via exerciseId).
 * @param position   order the exercise was performed within the session (from CSV row order).
 * @param note       exercise-scoped note (e.g. Strong notes that describe the whole movement).
 * @param sets       the logged sets, in order.
 */
public record ExerciseBlock(
        String exerciseId,
        String name,
        int position,
        String note,
        List<WorkoutSet> sets
) {}
