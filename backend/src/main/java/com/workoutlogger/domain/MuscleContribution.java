package com.workoutlogger.domain;

import java.math.BigDecimal;

/** How much one hard set of an exercise credits a muscle: 1.0 = primary, ~0.3-0.5 = secondary. */
public record MuscleContribution(Muscle muscle, BigDecimal fraction) {}
