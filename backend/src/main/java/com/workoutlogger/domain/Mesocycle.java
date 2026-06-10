package com.workoutlogger.domain;

import java.util.List;

/** A training block: {@code accumulationWeeks} of ramping volume then one deload week. Embedded in a Macrocycle. */
public record Mesocycle(
        String name,
        int accumulationWeeks,
        String phase,                 // SURPLUS | DEFICIT | MAINTENANCE (energy phase at creation)
        List<Muscle> focusMuscles
) {}
