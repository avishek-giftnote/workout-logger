package com.workoutlogger.domain;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A dated bodyweight measurement, embedded in {@link User#getBodyweightLog()}.
 *
 * <p>The id field is named {@code entryId}, NOT {@code id}: Spring Data maps any embedded field named
 * {@code id} to {@code _id}, which silently breaks dotted-path queries like
 * {@code bodyweightLog.entryId} (the same trap {@code setId} fixed for workout sets — DESIGN.md §3).
 * The wire DTO still calls it {@code id}; only the storage/property name changed. Legacy rows (stored
 * under {@code _id}, or with no id at all) are remediated once at startup by
 * {@code BodyweightEntryIdBackfillRunner} — never on the request path.
 */
public record BodyweightEntry(
        String entryId,     // stable id for amend/delete (null on legacy rows until the startup backfill)
        Instant recordedAt,
        BigDecimal weightKg,
        boolean estimated   // true for the single import-time backfill value
) {}
