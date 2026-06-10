package com.workoutlogger.domain;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * A single logged set, embedded inside an {@link ExerciseBlock}.
 *
 * @param setId         stable per-set identity (hex), so writes can address (workoutId, setId)
 *                      without array-position fragility, and a future sync layer can merge per set.
 *                      NOTE: named setId (not id) so Spring Data does not map it to the embedded _id.
 * @param orderIndex    position within the exercise block, from CSV row order (authoritative ordering).
 * @param setType       warmup vs working etc. (warmups excluded from working-set stats/PRs).
 * @param weight        canonical CUMULATIVE effective load (kg). For bodyweight exercises this already
 *                      includes bodyweight. Stored as Decimal128 in Mongo (exact; see MongoConfig).
 * @param loadMode      bodyweight/added/assisted decomposition (null for external exercises).
 * @param loadDelta     the added/assist delta the user actually enters (null for external).
 * @param weightUnit    "kg" canonical (lb display handled at the API/UI layer).
 * @param reps          repetitions (nullable).
 * @param rpe           rate of perceived exertion 1..10 (nullable; ~47% populated in import).
 * @param note          freeform per-set note (nullable).
 * @param loggedAt      real per-set timestamp; null for imported sets (no per-set time exists).
 * @param estimated     true when a value here was backfilled by the importer (e.g. bodyweight baseline).
 * @param importRowIndex 0-based index of the source CSV row, for lossless traceability.
 * @param rawImport     the original CSV row as a map, for the lossless backstop.
 */
public record WorkoutSet(
        String setId,
        int orderIndex,
        SetType setType,
        BigDecimal weight,
        LoadMode loadMode,
        BigDecimal loadDelta,
        String weightUnit,
        Integer reps,
        Integer rpe,
        String note,
        Instant loggedAt,
        boolean estimated,
        Integer importRowIndex,
        java.util.Map<String, String> rawImport,

        // ── cardio (all nullable; null/STRENGTH kind ⇒ a strength set) ──
        SetKind kind,               // null treated as STRENGTH
        BigDecimal distanceM,       // meters (Decimal128; string on wire)
        Integer durationS,          // per-effort seconds
        BigDecimal gradePct,        // treadmill continuous incline %
        BigDecimal elevationGainM,  // outdoor cumulative ascent, meters
        Integer cadenceSpm          // per-minute: steps / rpm / strokes (label by context)
        // pace & speed are DERIVED from distance/duration — never stored.
) {}
