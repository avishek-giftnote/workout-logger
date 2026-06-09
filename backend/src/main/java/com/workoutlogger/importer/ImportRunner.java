package com.workoutlogger.importer;

import com.workoutlogger.config.MongoSchemaInitializer;
import com.workoutlogger.domain.*;
import com.workoutlogger.repo.UserRepository;
import org.bson.types.ObjectId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Runs the one-time Strong CSV bootstrap. Active only under the "import" Spring profile.
 *
 *   Dry run (no Mongo):  --spring.profiles.active=import
 *   Persist to Mongo:    --spring.profiles.active=import --importer.persist=true
 *
 * On persist, history is owned by a real, loginable account (importer.user-email /
 * importer.user-password) so it shows up in the app after signing in.
 */
@Component
@Profile("import")
public class ImportRunner implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(ImportRunner.class);

    private final StrongImporter importer;
    private final ImportProperties props;
    private final MongoTemplate mongoTemplate;
    private final MongoSchemaInitializer schemaInitializer;
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;

    public ImportRunner(StrongImporter importer, ImportProperties props, MongoTemplate mongoTemplate,
                        MongoSchemaInitializer schemaInitializer, UserRepository users,
                        PasswordEncoder passwordEncoder) {
        this.importer = importer;
        this.props = props;
        this.mongoTemplate = mongoTemplate;
        this.schemaInitializer = schemaInitializer;
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    public void run(String... args) {
        Instant now = Instant.now();
        BigDecimal bodyweight = props.getCurrentBodyweightKg();

        log.info("Reading Strong CSV from {}", props.getCsvPath());
        List<Map<String, String>> rows = new StrongCsvReader().read(Path.of(props.getCsvPath()));
        log.info("Read {} raw rows; transforming (bodyweight baseline {} kg)...", rows.size(), bodyweight);

        // The owner id must be known before transform (it stamps every document).
        String userId = props.isPersist() ? resolveOwner(now, bodyweight).getId()
                                          : new ObjectId().toHexString();

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

        log.info("Persisting to MongoDB ({} exercises, {} templates, {} workouts) for {}...",
                result.exercises().size(), result.templates().size(), result.workouts().size(),
                props.getUserEmail());
        mongoTemplate.insert(result.exercises(), Exercise.class);
        mongoTemplate.insert(result.templates(), WorkoutTemplate.class);
        mongoTemplate.insert(result.workouts(), Workout.class);
        log.info("  ✅ persisted. Sign in as {} to see the imported history (userId={}).",
                props.getUserEmail(), userId);
    }

    /** Find-or-create the owning account, ensuring the schema/indexes exist first. */
    private User resolveOwner(Instant now, BigDecimal bodyweight) {
        schemaInitializer.initialize();
        String email = props.getUserEmail().trim().toLowerCase(Locale.ROOT);
        return users.findByEmail(email).map(existing -> {
            log.info("Importing into existing account {}", email);
            return existing;
        }).orElseGet(() -> {
            User u = new User();
            u.setId(new ObjectId().toHexString());
            u.setEmail(email);
            u.setPasswordHash(passwordEncoder.encode(props.getUserPassword()));
            u.setCurrentBodyweightKg(bodyweight);
            u.getBodyweightLog().add(new BodyweightEntry(now, bodyweight, true));
            u.setCreatedAt(now);
            u.setUpdatedAt(now);
            users.save(u);
            log.info("Created account {} (password = importer.user-password)", email);
            return u;
        });
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
