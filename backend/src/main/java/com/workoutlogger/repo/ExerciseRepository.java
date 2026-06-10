package com.workoutlogger.repo;

import com.workoutlogger.domain.CardioMetric;
import com.workoutlogger.domain.Equipment;
import com.workoutlogger.domain.Exercise;
import com.workoutlogger.domain.ExerciseCategory;
import com.workoutlogger.importer.StrongParsers;
import com.workoutlogger.security.Tenant;
import com.workoutlogger.web.error.ApiExceptions.ConflictException;
import org.bson.types.ObjectId;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/** Tenant-scoped access to the exercise catalog. Every query is AND-ed with the current userId. */
@Repository
public class ExerciseRepository {

    private final MongoTemplate mongo;
    private final Tenant tenant;

    public ExerciseRepository(MongoTemplate mongo, Tenant tenant) {
        this.mongo = mongo;
        this.tenant = tenant;
    }

    private Query owned() {
        return new Query(where("userId").is(tenant.userId()).and("deletedAt").is(null));
    }

    public List<Exercise> list() {
        return mongo.find(owned().with(Sort.by(Sort.Direction.ASC, "name")), Exercise.class);
    }

    public Optional<Exercise> findOne(String id) {
        Query q = owned().addCriteria(where("_id").is(id));
        return Optional.ofNullable(mongo.findOne(q, Exercise.class));
    }

    public Optional<Exercise> findByNameKey(String nameKey) {
        Query q = owned().addCriteria(where("nameKey").is(nameKey));
        return Optional.ofNullable(mongo.findOne(q, Exercise.class));
    }

    /** Creates a catalog entry, or 409s with the existing id if the normalized name already exists. */
    public Exercise create(String name, boolean isBodyweight, ExerciseCategory category,
                           Integer restSeconds, List<CardioMetric> cardioMetrics) {
        String nameKey = StrongParsers.nameKey(name);
        findByNameKey(nameKey).ifPresent(existing -> {
            throw new ConflictException("Exercise already exists",
                    Map.of("exerciseId", existing.getId(), "name", existing.getName()));
        });
        Instant now = Instant.now();
        Exercise e = new Exercise();
        e.setId(new ObjectId().toHexString());
        e.setUserId(tenant.userId());
        e.setName(StrongParsers.normalizeName(name));
        e.setNameKey(nameKey);
        e.setCategory(category == null ? ExerciseCategory.STRENGTH : category);
        e.setBodyweight(isBodyweight);
        e.setEquipment(isBodyweight ? Equipment.BODYWEIGHT : null);
        e.setDefaultUnit("kg");
        e.setRestSeconds(restSeconds);
        e.setCardioMetrics(cardioMetrics);
        e.setCreatedAt(now);
        e.setUpdatedAt(now);
        return mongo.insert(e);
    }

    /** Partial update — applies only the non-null fields. BODYWEIGHT keeps isBodyweight in sync. */
    public Optional<Exercise> update(String id, Equipment equipment, Integer restSeconds,
                                     List<CardioMetric> cardioMetrics) {
        return findOne(id).map(e -> {
            if (equipment != null) {
                e.setEquipment(equipment);
                e.setBodyweight(equipment == Equipment.BODYWEIGHT);
            }
            if (restSeconds != null) e.setRestSeconds(restSeconds < 0 ? null : restSeconds);
            if (cardioMetrics != null) e.setCardioMetrics(cardioMetrics);
            e.setUpdatedAt(Instant.now());
            return mongo.save(e);
        });
    }
}
