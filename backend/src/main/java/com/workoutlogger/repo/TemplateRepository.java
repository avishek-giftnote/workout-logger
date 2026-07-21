package com.workoutlogger.repo;

import com.workoutlogger.domain.TemplateExercise;
import com.workoutlogger.domain.WorkoutTemplate;
import com.workoutlogger.security.Tenant;
import org.bson.types.ObjectId;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/** Tenant-scoped access to workout templates. */
@Repository
public class TemplateRepository {

    private final MongoTemplate mongo;
    private final Tenant tenant;

    public TemplateRepository(MongoTemplate mongo, Tenant tenant) {
        this.mongo = mongo;
        this.tenant = tenant;
    }

    public List<WorkoutTemplate> list() {
        Query q = new Query(where("userId").is(tenant.userId())).with(Sort.by(Sort.Direction.ASC, "name"));
        return mongo.find(q, WorkoutTemplate.class);
    }

    /** Account-wipe cascade: purge ALL of this tenant's templates. */
    public long deleteAllForTenant() {
        return mongo.remove(new Query(where("userId").is(tenant.userId())), WorkoutTemplate.class).getDeletedCount();
    }

    public Optional<WorkoutTemplate> findOne(String id) {
        Query q = new Query(where("userId").is(tenant.userId()).and("_id").is(id));
        return Optional.ofNullable(mongo.findOne(q, WorkoutTemplate.class));
    }

    public WorkoutTemplate create(String name, List<TemplateExercise> exercises) {
        Instant now = Instant.now();
        WorkoutTemplate t = new WorkoutTemplate();
        t.setId(new ObjectId().toHexString());
        t.setUserId(tenant.userId());
        t.setName(name);
        t.setExercises(exercises);
        t.setCreatedAt(now);
        t.setUpdatedAt(now);
        return mongo.insert(t);
    }

    public Optional<WorkoutTemplate> update(String id, String name, List<TemplateExercise> exercises) {
        return findOne(id).map(t -> {        // findOne is tenant-scoped → ownership enforced
            t.setName(name);
            t.setExercises(exercises);
            t.setUpdatedAt(Instant.now());
            return mongo.save(t);
        });
    }
}
