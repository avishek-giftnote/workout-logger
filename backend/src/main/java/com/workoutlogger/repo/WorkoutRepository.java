package com.workoutlogger.repo;

import com.workoutlogger.domain.SetType;
import com.workoutlogger.domain.Workout;
import com.workoutlogger.security.Tenant;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.aggregation.AggregationResults;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.springframework.data.mongodb.core.aggregation.Aggregation.*;
import static org.springframework.data.mongodb.core.query.Criteria.where;

/** Tenant-scoped access to workout sessions. Every query/update is AND-ed with the current userId. */
@Repository
public class WorkoutRepository {

    private final MongoTemplate mongo;
    private final Tenant tenant;

    public WorkoutRepository(MongoTemplate mongo, Tenant tenant) {
        this.mongo = mongo;
        this.tenant = tenant;
    }

    private Query owned() {
        return new Query(where("userId").is(tenant.userId()).and("deletedAt").is(null));
    }

    public List<Workout> list() {
        return mongo.find(owned().with(Sort.by(Sort.Direction.DESC, "startedAt")), Workout.class);
    }

    public Optional<Workout> findOne(String id) {
        return Optional.ofNullable(mongo.findOne(owned().addCriteria(where("_id").is(id)), Workout.class));
    }

    /** Inserts a session, forcing ownership to the current user (client id never trusted). */
    public Workout insert(Workout w) {
        Instant now = Instant.now();
        w.setUserId(tenant.userId());
        w.setDeletedAt(null);
        if (w.getCreatedAt() == null) w.setCreatedAt(now);
        w.setUpdatedAt(now);
        return mongo.insert(w);
    }

    /** Replace a session's exercises/sets + deload flag + soreness report (full edit of a completed workout).
     *  null cyclePhase/soreMuscles clear the stored value — the edit screen always sends the current ones. */
    public Optional<Workout> replaceExercises(String id, List<com.workoutlogger.domain.ExerciseBlock> exercises,
                                              String templateId, com.workoutlogger.domain.CyclePhase cyclePhase,
                                              List<com.workoutlogger.domain.Muscle> soreMuscles) {
        return findOne(id).map(w -> {
            w.setExercises(exercises);
            w.setTemplateId(templateId);
            w.setCyclePhase(cyclePhase);
            w.setSoreMuscles(soreMuscles);
            w.setUpdatedAt(Instant.now());
            return mongo.save(w);
        });
    }

    public boolean softDelete(String id) {
        Update u = new Update().set("deletedAt", Instant.now()).set("updatedAt", Instant.now());
        return mongo.updateFirst(owned().addCriteria(where("_id").is(id)), u, Workout.class)
                .getModifiedCount() > 0;
    }

    /**
     * Granular set update addressed by (workoutId, setId) — array-position independent.
     * Only non-null fields are applied. Bumps version + updatedAt.
     */
    public boolean updateSet(String workoutId, String setId, BigDecimal weight, Integer reps,
                             Integer rpe, String note, SetType setType, BigDecimal loadDelta) {
        Query q = new Query(where("_id").is(workoutId)
                .and("userId").is(tenant.userId())
                .and("deletedAt").is(null));
        Update u = new Update().set("updatedAt", Instant.now()).inc("version", 1)
                .filterArray(Criteria.where("s.setId").is(setId));
        if (weight != null)    u.set("exercises.$[].sets.$[s].weight", weight);
        if (reps != null)      u.set("exercises.$[].sets.$[s].reps", reps);
        if (rpe != null)       u.set("exercises.$[].sets.$[s].rpe", rpe);
        if (note != null)      u.set("exercises.$[].sets.$[s].note", note);
        if (setType != null)   u.set("exercises.$[].sets.$[s].setType", setType);
        if (loadDelta != null) u.set("exercises.$[].sets.$[s].loadDelta", loadDelta);
        return mongo.updateFirst(q, u, Workout.class).getModifiedCount() > 0;
    }

    /**
     * Most-recent WORKING set for an exercise (DESIGN.md §3 fix). Deterministic: warmups and
     * soft-deleted sessions excluded; ties on the shared session timestamp broken by orderIndex desc.
     */
    public Optional<LastWorkingSetView> lastWorkingSet(String exerciseId) {
        Aggregation agg = newAggregation(
                match(where("userId").is(tenant.userId()).and("deletedAt").is(null)
                        .and("exercises.exerciseId").is(exerciseId)),
                unwind("exercises"),
                match(where("exercises.exerciseId").is(exerciseId)),
                unwind("exercises.sets"),
                match(where("exercises.sets.setType").is(SetType.WORKING.name())),
                sort(Sort.by(Sort.Direction.DESC, "startedAt")
                        .and(Sort.by(Sort.Direction.DESC, "exercises.sets.orderIndex"))),
                limit(1),
                project()
                        .and("exercises.name").as("exerciseName")
                        .and("startedAt").as("startedAt")
                        .and("exercises.sets.orderIndex").as("orderIndex")
                        .and("exercises.sets.weight").as("weight")
                        .and("exercises.sets.loadMode").as("loadMode")
                        .and("exercises.sets.loadDelta").as("loadDelta")
                        .and("exercises.sets.reps").as("reps")
                        .and("exercises.sets.rpe").as("rpe"));
        AggregationResults<LastWorkingSetView> res =
                mongo.aggregate(agg, "workouts", LastWorkingSetView.class);
        return Optional.ofNullable(res.getUniqueMappedResult());
    }
}
