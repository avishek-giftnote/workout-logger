package com.workoutlogger.importer;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workoutlogger.domain.Equipment;
import com.workoutlogger.domain.Exercise;
import com.workoutlogger.domain.ExerciseCategory;
import com.workoutlogger.domain.Laterality;
import com.workoutlogger.domain.Mechanic;
import com.workoutlogger.domain.Muscle;
import com.workoutlogger.domain.MuscleContribution;
import org.bson.types.ObjectId;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Seeds a new user's catalog from {@code resources/default-exercises.json} — the shared starting set with
 * muscle map, bodyweight + loadability, laterality, and mechanic. Inserted directly (not tenant-scoped) at
 * registration. See docs/coach.md and DESIGN.md.
 */
@Service
public class DefaultExerciseSeeder {

    private final MongoTemplate mongo;
    private final List<Seed> seeds;

    public DefaultExerciseSeeder(MongoTemplate mongo, ObjectMapper json) {
        this.mongo = mongo;
        try (InputStream in = new ClassPathResource("default-exercises.json").getInputStream()) {
            this.seeds = json.readValue(in, new TypeReference<List<Seed>>() {});
        } catch (IOException e) {
            throw new IllegalStateException("Cannot load default-exercises.json", e);
        }
    }

    public int count() { return seeds.size(); }

    /** Creates the default catalog for a freshly-registered user. */
    public void seed(String userId) {
        Instant now = Instant.now();
        List<Exercise> list = new ArrayList<>(seeds.size());
        for (Seed s : seeds) {
            Exercise e = new Exercise();
            e.setId(new ObjectId().toHexString());
            e.setUserId(userId);
            e.setName(StrongParsers.normalizeName(s.name()));
            e.setNameKey(StrongParsers.nameKey(s.name()));
            e.setCategory(s.category() == null ? ExerciseCategory.STRENGTH : ExerciseCategory.valueOf(s.category()));
            e.setEquipment(s.equipment() == null ? null : Equipment.valueOf(s.equipment()));
            e.setBodyweight(s.isBodyweight());
            e.setLoadable(s.loadable());
            e.setLaterality(s.laterality() == null ? null : Laterality.valueOf(s.laterality()));
            e.setMechanic(s.mechanic() == null ? null : Mechanic.valueOf(s.mechanic()));
            e.setDefaultUnit("kg");
            if (s.muscles() != null && !s.muscles().isEmpty()) {
                e.setMuscleContributions(s.muscles().stream()
                        .map(m -> new MuscleContribution(Muscle.valueOf(m.muscle()), new BigDecimal(m.fraction())))
                        .toList());
            }
            e.setCreatedAt(now);
            e.setUpdatedAt(now);
            list.add(e);
        }
        mongo.insert(list, Exercise.class);
    }

    record Seed(String name, String category, String equipment, boolean isBodyweight, Boolean loadable,
                String laterality, String mechanic, List<M> muscles) {}
    record M(String muscle, String fraction) {}
}
