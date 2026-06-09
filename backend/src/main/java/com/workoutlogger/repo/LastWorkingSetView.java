package com.workoutlogger.repo;

import java.math.BigDecimal;
import java.time.Instant;

/** Projection of the most-recent working set for an exercise (the "copy last set" source). */
public record LastWorkingSetView(
        String exerciseName,
        Instant startedAt,
        int orderIndex,
        BigDecimal weight,
        String loadMode,
        BigDecimal loadDelta,
        Integer reps,
        Integer rpe
) {}
