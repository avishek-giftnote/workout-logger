package com.workoutlogger.domain;

/** An exercise slot within a {@link WorkoutTemplate}, in performance order. */
public record TemplateExercise(
        String exerciseId,
        String name,
        int position
) {}
