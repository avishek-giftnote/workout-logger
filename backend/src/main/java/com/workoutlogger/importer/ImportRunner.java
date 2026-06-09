package com.workoutlogger.importer;

import com.workoutlogger.config.MongoSchemaInitializer;
import com.workoutlogger.domain.*;
import org.bson.types.ObjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Runs the one-time Strong CSV bootstrap. Active only under the "import" Spring profile.
 *
 *   Dry run (no Mongo):  --spring.profiles.active=import
 *   Persist to Mongo:    --spring.profiles.active=import --importer.persist=true
 *
 * Always parses + asserts the verified counts (fails loud on drift). Persists only when configured.
 */
@Component
@Profile("import")
public class ImportRunner implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(ImportRunner.class);

    private final StrongImporter importer;
    private final ImportProperties props;
    private final MongoTemplate mongoTemplate;
    private final MongoSchemaInitializer schemaInitializer;

    public ImportRunner(StrongImporter importer, ImportProperties props,
                        MongoTemplate mongoTemplate, MongoSchemaInitializer schemaInitializer) {
        this.importer = importer;
        this.props = props;
        this.mongoTemplate = mongoTemplate;
        this.schemaInitializer = schemaInitializer;
    }

    @Override
    public void run(String... args) {
        Instant now = Instant.now();
        String userId = new ObjectId().toHexString();
        BigDecimal bodyweight = props.getCurrentBodyweightKg();

        log.info("Reading Strong CSV from {}", props.getCsvPath());
        List<Map<String, String>> rows = new StrongCsvReader().read(Path.of(props.getCsvPath()));
        log.info("Read {} raw rows; transforming (bodyweight baseline {} kg)...", rows.size(), bodyweight);

        ImportResult result = importer.transform(rows, bodyweight, userId, now);
        Counts c = result.counts();

        log.info("=== IMPORT RECONCILIATION ===");
        log.info("  {}", c.describe(Counts.EXPECTED));
        if (!c.equals(Counts.EXPECTED)) {
            throw new IllegalStateException("Import counts do not match verified expectations: "
                    + c.describe(Counts.EXPECTED));
        }
        log.info("  ✅ all counts match verified expectations");
        logSpotCheck(result, bodyweight);

        if (!props.isPersist()) {
            log.info("importer.persist=false → parsed + asserted only, nothing written. "
                    + "Re-run with --importer.persist=true (and MongoDB up) to load.");
            return;
        }

        log.info("Persisting to MongoDB ({} exercises, {} templates, {} workouts)...",
                result.exercises().size(), result.templates().size(), result.workouts().size());
        schemaInitializer.initialize();

        User user = new User();
        user.setId(userId);
        user.setEmail("importer@example.com");
        user.setCurrentBodyweightKg(bodyweight);
        user.getBodyweightLog().add(new BodyweightEntry(now, bodyweight, true));
        user.setCreatedAt(now);
        user.setUpdatedAt(now);

        mongoTemplate.insert(user);
        mongoTemplate.insert(result.exercises(), Exercise.class);
        mongoTemplate.insert(result.templates(), WorkoutTemplate.class);
        mongoTemplate.insert(result.workouts(), Workout.class);
        log.info("  ✅ persisted. userId={}", userId);
    }

    private void logSpotCheck(ImportResult result, BigDecimal bodyweight) {
        log.info("--- bodyweight spot check (baseline {} kg) ---", bodyweight);
        result.workouts().stream()
                .flatMap(w -> w.getExercises().stream())
                .filter(b -> "Pull Up".equals(b.name()))
                .findFirst()
                .ifPresent(b -> b.sets().stream().limit(4).forEach(s ->
                        log.info("  Pull Up: mode={} delta={} -> effective {} kg x {} reps (estimated={})",
                                s.loadMode(), s.loadDelta(), s.weight(), s.reps(), s.estimated())));
    }
}
