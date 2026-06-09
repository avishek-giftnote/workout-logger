package com.workoutlogger.repo;

import com.workoutlogger.domain.WorkoutTemplate;
import com.workoutlogger.security.Tenant;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/** Tenant-scoped read access to workout templates. */
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

    public Optional<WorkoutTemplate> findOne(String id) {
        Query q = new Query(where("userId").is(tenant.userId()).and("_id").is(id));
        return Optional.ofNullable(mongo.findOne(q, WorkoutTemplate.class));
    }
}
