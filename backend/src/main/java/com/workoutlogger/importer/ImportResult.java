package com.workoutlogger.importer;

import com.workoutlogger.domain.Exercise;
import com.workoutlogger.domain.Workout;
import com.workoutlogger.domain.WorkoutTemplate;

import java.util.List;

/** The full transformed document tree plus reconciliation counts. */
public record ImportResult(
        List<Exercise> exercises,
        List<WorkoutTemplate> templates,
        List<Workout> workouts,
        Counts counts
) {}
