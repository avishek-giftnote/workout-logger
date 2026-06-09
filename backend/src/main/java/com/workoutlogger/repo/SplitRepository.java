package com.workoutlogger.repo;

import com.workoutlogger.domain.Split;
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

/** Tenant-scoped access to splits (named groupings of templates). */
@Repository
public class SplitRepository {

    private final MongoTemplate mongo;
    private final Tenant tenant;

    public SplitRepository(MongoTemplate mongo, Tenant tenant) {
        this.mongo = mongo;
        this.tenant = tenant;
    }

    private Query owned() { return new Query(where("userId").is(tenant.userId())); }

    public List<Split> list() {
        return mongo.find(owned().with(Sort.by(Sort.Direction.ASC, "name")), Split.class);
    }

    public Optional<Split> findOne(String id) {
        return Optional.ofNullable(mongo.findOne(owned().addCriteria(where("_id").is(id)), Split.class));
    }

    public Split create(String name, List<String> templateIds) {
        Instant now = Instant.now();
        Split s = new Split();
        s.setId(new ObjectId().toHexString());
        s.setUserId(tenant.userId());
        s.setName(name);
        s.setTemplateIds(templateIds);
        s.setCreatedAt(now);
        s.setUpdatedAt(now);
        return mongo.insert(s);
    }

    public Optional<Split> update(String id, String name, List<String> templateIds) {
        return findOne(id).map(s -> {
            s.setName(name);
            s.setTemplateIds(templateIds);
            s.setUpdatedAt(Instant.now());
            return mongo.save(s);
        });
    }

    public boolean delete(String id) {
        return mongo.remove(owned().addCriteria(where("_id").is(id)), Split.class).getDeletedCount() > 0;
    }
}
