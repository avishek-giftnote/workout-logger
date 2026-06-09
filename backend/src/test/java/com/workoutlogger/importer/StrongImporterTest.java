package com.workoutlogger.importer;

import com.workoutlogger.domain.ExerciseBlock;
import com.workoutlogger.domain.LoadMode;
import com.workoutlogger.domain.WorkoutSet;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Proves the importer transform against the REAL Strong export — the Java equivalent of
 * tools/verify_import.py. Expects strong_workouts.csv one level above the backend module.
 */
class StrongImporterTest {

    private static final Path CSV = Path.of("../strong_workouts.csv");
    private static final BigDecimal BODYWEIGHT = new BigDecimal("75.0");

    @Test
    void importsRealExportWithExactCounts() {
        assumeTrue(Files.exists(CSV), "strong_workouts.csv not found next to the project root");

        List<Map<String, String>> rows = new StrongCsvReader().read(CSV);
        ImportResult result = new StrongImporter()
                .transform(rows, BODYWEIGHT, "test-user", Instant.parse("2026-06-09T00:00:00Z"));

        assertEquals(Counts.EXPECTED, result.counts(),
                "import counts must match the verified expectations");
        assertEquals(30, result.exercises().size());
        assertEquals(4, result.templates().size());
    }

    @Test
    void weightedPullUpRoundTripsAsCumulativeLoadWithDecomposition() {
        assumeTrue(Files.exists(CSV), "strong_workouts.csv not found");

        List<Map<String, String>> rows = new StrongCsvReader().read(CSV);
        ImportResult result = new StrongImporter()
                .transform(rows, BODYWEIGHT, "test-user", Instant.parse("2026-06-09T00:00:00Z"));

        WorkoutSet weighted = result.workouts().stream()
                .flatMap(w -> w.getExercises().stream())
                .filter(b -> "Pull Up".equals(b.name()))
                .flatMap(b -> b.sets().stream())
                .filter(s -> s.loadMode() == LoadMode.ADDED)
                .findFirst().orElseThrow();

        // Strong logged +10 added; effective load = bodyweight + 10, decomposition preserved.
        assertEquals(0, new BigDecimal("10.0").compareTo(weighted.loadDelta()));
        assertEquals(0, new BigDecimal("85.0").compareTo(weighted.weight()));
        assertTrue(weighted.estimated());

        WorkoutSet pureBw = result.workouts().stream()
                .flatMap(w -> w.getExercises().stream())
                .filter(b -> "Pull Up".equals(b.name()))
                .flatMap(b -> b.sets().stream())
                .filter(s -> s.loadMode() == LoadMode.BODYWEIGHT)
                .findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("75.0").compareTo(pureBw.weight()));
    }

    @Test
    void allSetsCarryLosslessRawImport() {
        assumeTrue(Files.exists(CSV), "strong_workouts.csv not found");
        List<Map<String, String>> rows = new StrongCsvReader().read(CSV);
        ImportResult result = new StrongImporter()
                .transform(rows, BODYWEIGHT, "test-user", Instant.parse("2026-06-09T00:00:00Z"));

        for (var w : result.workouts()) {
            for (ExerciseBlock b : w.getExercises()) {
                for (WorkoutSet s : b.sets()) {
                    assertNotNull(s.rawImport().get("Date"));
                    assertNotNull(s.setId());
                }
            }
        }
    }
}
