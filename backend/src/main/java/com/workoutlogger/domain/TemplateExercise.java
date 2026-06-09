package com.workoutlogger.domain;

/** An exercise slot within a {@link WorkoutTemplate}, in performance order. */
public record TemplateExercise(
        String exerciseId,
        String name,
        int position,
        int sets            // planned number of sets (from the most recent session at import/update)
) {}
