package com.workoutlogger.importer;

import com.workoutlogger.domain.*;
import org.bson.types.ObjectId;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

/**
 * Transforms scoped Strong CSV rows into the MongoDB document tree (DESIGN.md §4-§5).
 * Pure and deterministic given (rows, bodyweight, userId, now): no Mongo, no I/O.
 * This is the production mirror of the verified reference in tools/verify_import.py.
 */
@Component
public class StrongImporter {

    /** Only these 4 templates are imported (product-owner scope). */
    public static final Set<String> SCOPED_TEMPLATES = Set.of(
            "Anterior (Upper focus)", "Anterior (Lower focus)",
            "Posterior (Upper focus)", "Posterior (Lower focus)");

    /** Verbatim bodyweight exercise names (shorthand "Knee Raise" has zero rows). */
    public static final Set<String> BODYWEIGHT_NAMES = Set.of(
            "Pull Up", "Knee Raise (Captain's Chair)");

    public ImportResult transform(List<Map<String, String>> allRows, BigDecimal bodyweightKg,
                                  String userId, Instant now) {
        List<Map<String, String>> rows = allRows.stream()
                .filter(r -> SCOPED_TEMPLATES.contains(r.get("Workout Name")))
                .toList();

        Map<String, Exercise> catalog = new LinkedHashMap<>();          // NFC name -> catalog doc
        Map<Instant, SessionAcc> sessions = new LinkedHashMap<>();      // startedAt -> session acc
        int warmups = 0;
        int bodyweightRows = 0;

        for (int idx = 0; idx < rows.size(); idx++) {
            Map<String, String> r = rows.get(idx);

            Instant startedAt = StrongParsers.parseStartedAt(r.get("Date"));
            SessionAcc sess = sessions.computeIfAbsent(startedAt, k -> new SessionAcc(
                    startedAt, r.get("Workout Name"),
                    StrongParsers.parseDurationSeconds(r.get("Duration")), r.get("Duration")));

            String name = StrongParsers.normalizeName(r.get("Exercise Name"));
            boolean isBw = BODYWEIGHT_NAMES.contains(name);
            Exercise exercise = catalog.computeIfAbsent(name, n -> newExercise(n, isBw, userId, now));

            BlockAcc block = sess.blocks.computeIfAbsent(name,
                    n -> new BlockAcc(exercise.getId(), n, sess.blocks.size()));

            String setOrder = trim(r.get("Set Order"));
            SetType setType = "W".equals(setOrder) ? SetType.WARMUP : SetType.WORKING;
            if (setType == SetType.WARMUP) warmups++;

            String rawWeight = trim(r.get("Weight"));
            BigDecimal strongWeight = (rawWeight == null || rawWeight.isBlank())
                    ? BigDecimal.ZERO : new BigDecimal(rawWeight);

            BigDecimal weight;
            LoadMode loadMode;
            BigDecimal loadDelta;
            boolean estimated;
            if (isBw) {
                if (strongWeight.signum() == 0) bodyweightRows++;
                // Strong's Weight on a bodyweight exercise is the ADDED delta.
                loadDelta = strongWeight;
                loadMode = strongWeight.signum() == 0 ? LoadMode.BODYWEIGHT : LoadMode.ADDED;
                weight = bodyweightKg.add(strongWeight);   // cumulative effective load
                estimated = true;                          // backfilled bodyweight baseline
            } else {
                loadDelta = null;
                loadMode = null;
                weight = strongWeight;
                estimated = false;
            }

            block.sets.add(new WorkoutSet(
                    new ObjectId().toHexString(),
                    block.sets.size(),
                    setType,
                    weight,
                    loadMode,
                    loadDelta,
                    "kg",
                    parseIntFlexible(r.get("Reps")),
                    parseIntFlexible(r.get("RPE")),
                    blankToNull(r.get("Notes")),
                    null,                                  // loggedAt: no per-set time in export
                    estimated,
                    idx,
                    new LinkedHashMap<>(r)                 // lossless raw row
            ));
        }

        List<WorkoutTemplate> templates = reconstructTemplates(sessions, catalog, userId, now);
        Map<String, String> templateIdByName = new LinkedHashMap<>();
        for (WorkoutTemplate t : templates) templateIdByName.put(t.getName(), t.getId());

        // Link each session to its template (by Strong workout name) so the app can load the
        // previous session when a user starts a workout from a template.
        List<Workout> workouts = new ArrayList<>();
        for (SessionAcc s : sessions.values()) {
            Workout w = s.toWorkout(userId, now);
            w.setTemplateId(templateIdByName.get(s.name));
            workouts.add(w);
        }

        int totalSets = sessions.values().stream()
                .flatMap(s -> s.blocks.values().stream())
                .mapToInt(b -> b.sets.size()).sum();
        Counts counts = new Counts(totalSets, sessions.size(), catalog.size(), warmups, bodyweightRows);

        return new ImportResult(new ArrayList<>(catalog.values()), templates, workouts, counts);
    }

    private List<WorkoutTemplate> reconstructTemplates(Map<Instant, SessionAcc> sessions,
                                                       Map<String, Exercise> catalog,
                                                       String userId, Instant now) {
        // Most-recent instance of each scoped name wins (sessions iterate in file order).
        Map<String, SessionAcc> latestByName = new LinkedHashMap<>();
        for (SessionAcc s : sessions.values()) latestByName.put(s.name, s);

        List<WorkoutTemplate> templates = new ArrayList<>();
        for (Map.Entry<String, SessionAcc> e : latestByName.entrySet()) {
            SessionAcc src = e.getValue();
            List<TemplateExercise> exs = new ArrayList<>();
            for (BlockAcc b : src.blocks.values()) {
                exs.add(new TemplateExercise(b.exerciseId, b.name, b.position, b.sets.size()));
            }
            WorkoutTemplate t = new WorkoutTemplate();
            t.setId(new ObjectId().toHexString());
            t.setUserId(userId);
            t.setName(e.getKey());
            t.setExercises(exs);
            t.setCreatedAt(now);
            t.setUpdatedAt(now);
            templates.add(t);
        }
        return templates;
    }

    private Exercise newExercise(String name, boolean isBw, String userId, Instant now) {
        Exercise ex = new Exercise();
        ex.setId(new ObjectId().toHexString());
        ex.setUserId(userId);
        ex.setName(name);
        ex.setNameKey(StrongParsers.nameKey(name));
        ex.setBodyweight(isBw);
        ex.setEquipment(isBw ? Equipment.BODYWEIGHT : parseEquipment(name));
        ex.setCategory(ExerciseCategory.STRENGTH);
        ex.setDefaultUnit("kg");
        ex.setCreatedAt(now);
        ex.setUpdatedAt(now);
        return ex;
    }

    /** Best-effort equipment from a Strong name suffix; null if unknown (user sets it in the app). */
    static Equipment parseEquipment(String name) {
        String n = name.toLowerCase();
        if (n.contains("(barbell)")) return Equipment.BARBELL;
        if (n.contains("(dumbbell)")) return Equipment.DUMBBELL;
        if (n.contains("(cable")) return Equipment.CABLE;          // incl. "(Cable - Straight Bar)"
        if (n.contains("(machine)") || n.contains("(plate loaded)")) return Equipment.MACHINE;
        if (n.contains("smith")) return Equipment.SMITH_MACHINE;
        if (n.contains("kettlebell")) return Equipment.KETTLEBELL;
        return null;
    }

    private static String trim(String s) { return s == null ? null : s.trim(); }

    private static String blankToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    private static Integer parseIntFlexible(String s) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        return (int) Math.round(Double.parseDouble(t));   // handles "7" and "7.0"
    }

    /** Mutable session accumulator. */
    private static final class SessionAcc {
        final Instant startedAt;
        final String name;
        final Integer durationSeconds;
        final String rawDuration;
        final Map<String, BlockAcc> blocks = new LinkedHashMap<>();

        SessionAcc(Instant startedAt, String name, Integer durationSeconds, String rawDuration) {
            this.startedAt = startedAt;
            this.name = name;
            this.durationSeconds = durationSeconds;
            this.rawDuration = rawDuration;
        }

        Workout toWorkout(String userId, Instant now) {
            Workout w = new Workout();
            w.setId(new ObjectId().toHexString());
            w.setUserId(userId);
            w.setStartedAt(startedAt);
            w.setDurationSeconds(durationSeconds);
            w.setRawDurationText(rawDuration);
            List<ExerciseBlock> exercises = new ArrayList<>();
            for (BlockAcc b : blocks.values()) {
                exercises.add(new ExerciseBlock(b.exerciseId, b.name, b.position, b.note,
                        List.copyOf(b.sets)));
            }
            w.setExercises(exercises);
            w.setCreatedAt(now);
            w.setUpdatedAt(now);
            return w;
        }
    }

    /** Mutable exercise-block accumulator. */
    private static final class BlockAcc {
        final String exerciseId;
        final String name;
        final int position;
        final String note = null;
        final List<WorkoutSet> sets = new ArrayList<>();

        BlockAcc(String exerciseId, String name, int position) {
            this.exerciseId = exerciseId;
            this.name = name;
            this.position = position;
        }
    }
}
