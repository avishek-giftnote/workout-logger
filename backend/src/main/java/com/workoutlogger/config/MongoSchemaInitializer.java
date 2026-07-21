package com.workoutlogger.config;

import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.CreateCollectionOptions;
import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.ValidationOptions;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Creates collections with $jsonSchema validators and the indexes from DESIGN.md §2 — the only
 * database-level guard, since MongoDB has no schema or RLS. Invoked by the importer when persisting;
 * a normal server start would call the same routine. Idempotent: skips existing collections,
 * createIndex is a no-op if the index already exists.
 */
@Component
public class MongoSchemaInitializer {

    private final MongoTemplate mongoTemplate;

    public MongoSchemaInitializer(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;
    }

    public void initialize() {
        MongoDatabase db = mongoTemplate.getDb();
        List<String> existing = new java.util.ArrayList<>();
        db.listCollectionNames().forEach(existing::add);

        createIfAbsent(db, existing, "workouts", workoutsSchema());
        createIfAbsent(db, existing, "exercises", exercisesSchema());
        createIfAbsent(db, existing, "templates", null);
        createIfAbsent(db, existing, "users", null);
        createIfAbsent(db, existing, "splits", null);
        createIfAbsent(db, existing, "plans", null);
        createIfAbsent(db, existing, "authChallenges", null);

        // Indexes (DESIGN §2).
        db.getCollection("workouts").createIndex(
                new Document("userId", 1).append("startedAt", -1));
        db.getCollection("workouts").createIndex(
                new Document("userId", 1).append("exercises.exerciseId", 1).append("startedAt", -1));
        db.getCollection("workouts").createIndex(
                new Document("userId", 1).append("startedAt", 1),
                new IndexOptions().unique(true).name("uniq_user_startedAt"));

        // exercises: partial-unique on the normalized name. MongoDB forbids $exists:false (it
        // compiles to $not), so we scope on nameKey existing — every live exercise has a nameKey;
        // a future soft-delete unsets nameKey to drop the tombstone out of the unique constraint.
        db.getCollection("exercises").createIndex(
                new Document("userId", 1).append("nameKey", 1),
                new IndexOptions().unique(true).name("uniq_user_nameKey")
                        .partialFilterExpression(new Document("nameKey", new Document("$exists", true))));

        db.getCollection("templates").createIndex(new Document("userId", 1).append("name", 1));

        db.getCollection("users").createIndex(
                new Document("email", 1), new IndexOptions().unique(true).name("uniq_email"));

        // plans: at most ONE ACTIVE macrocycle per user (council H1). Partial-unique on userId scoped to
        // status==ACTIVE — many terminal (COMPLETED/ENDED) plans per user are fine, but two simultaneous
        // ACTIVE inserts (the non-atomic updateMulti-then-insert race in PlanRepository.create) collide on
        // this index and the loser gets DuplicateKey → 409, instead of leaving the user with two ACTIVE plans.
        db.getCollection("plans").createIndex(
                new Document("userId", 1),
                new IndexOptions().unique(true).name("uniq_user_active_plan")
                        .partialFilterExpression(new Document("status", "ACTIVE")));

        // authChallenges: at most ONE live challenge per {email, purpose} (atomic upsert replaces on
        // re-request → no accumulation/squat), plus a TTL sweep on expiresAt so spent/abandoned challenges
        // self-delete. Correctness (expiry, single-use, attempt cap) is code-enforced; these are hygiene.
        db.getCollection("authChallenges").createIndex(
                new Document("email", 1).append("purpose", 1),
                new IndexOptions().unique(true).name("uniq_email_purpose"));
        db.getCollection("authChallenges").createIndex(
                new Document("expiresAt", 1),
                new IndexOptions().name("ttl_expiresAt").expireAfter(0L, java.util.concurrent.TimeUnit.SECONDS));
    }

    private void createIfAbsent(MongoDatabase db, List<String> existing, String name, Document schema) {
        if (existing.contains(name)) return;
        CreateCollectionOptions opts = new CreateCollectionOptions();
        if (schema != null) {
            opts.validationOptions(new ValidationOptions().validator(new Document("$jsonSchema", schema)));
        }
        db.createCollection(name, opts);
    }

    private Document workoutsSchema() {
        Document setProps = new Document()
                .append("weight", new Document("bsonType", List.of("decimal", "null")))
                .append("loadDelta", new Document("bsonType", List.of("decimal", "null")))
                .append("setType", new Document("enum", List.of("WARMUP", "WORKING", "DROP", "FAILURE")))
                .append("loadMode", new Document("bsonType", List.of("string", "null")))
                .append("rpe", new Document("bsonType", List.of("int", "null")).append("minimum", 1).append("maximum", 10))
                .append("reps", new Document("bsonType", List.of("int", "null")).append("minimum", 0))
                // cardio (all nullable; pace/speed are derived, never stored)
                .append("kind", new Document("enum", List.of("STRENGTH", "CARDIO")))
                .append("distanceM", new Document("bsonType", List.of("decimal", "null")).append("minimum", 0))
                .append("durationS", new Document("bsonType", List.of("int", "null")).append("minimum", 0))
                .append("gradePct", new Document("bsonType", List.of("decimal", "null")))   // signed (like weight)
                .append("elevationGainM", new Document("bsonType", List.of("decimal", "null")).append("minimum", 0))
                .append("cadenceSpm", new Document("bsonType", List.of("int", "null")).append("minimum", 0));

        Document set = new Document("bsonType", "object").append("properties", setProps);
        Document block = new Document("bsonType", "object")
                .append("properties", new Document("sets", new Document("bsonType", "array").append("items", set)));

        return new Document("bsonType", "object")
                .append("required", List.of("userId", "startedAt"))
                .append("properties", new Document()
                        .append("startedAt", new Document("bsonType", "date"))
                        .append("exercises", new Document("bsonType", "array").append("items", block)));
    }

    private Document exercisesSchema() {
        return new Document("bsonType", "object")
                .append("required", List.of("userId", "name", "nameKey"))
                .append("properties", new Document()
                        .append("name", new Document("bsonType", "string"))
                        .append("nameKey", new Document("bsonType", "string"))
                        .append("isBodyweight", new Document("bsonType", "bool")));
    }
}
