package com.workoutlogger.domain;

import java.math.BigDecimal;
import java.time.Instant;

/** A dated bodyweight measurement, embedded in {@link User#getBodyweightLog()}. */
public record BodyweightEntry(
        String id,          // stable id for amend/delete (null on legacy rows → backfilled on read)
        Instant recordedAt,
        BigDecimal weightKg,
        boolean estimated   // true for the single import-time backfill value
) {}
