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

    /** Count this tenant's (non-deleted) sessions started at/after {@code since} — the trailing-window training
     *  frequency the energy model turns into a display-only workout-energy term. Tenant-AND-ed via owned(). */
    public long countSince(Instant since) {
        return mongo.count(owned().addCriteria(where("startedAt").gte(since)), Workout.class);
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

    /** Outcome of a granular set update — a 3-state result so the controller cannot silently collapse a
     *  stale write into a 404 (the compiler forces success/conflict/not-found to be handled). */
    public enum SetUpdateResult { UPDATED, VERSION_CONFLICT, NOT_FOUND }

    /**
     * Granular set update addressed by (workoutId, setId) — array-position independent.
     * Only non-null fields are applied. Bumps version + updatedAt.
     *
     * <p>Optimistic lock: when {@code expectedVersion} is non-null it is ANDed into the match as an
     * If-Match precondition — a stale value matches nothing and yields {@code VERSION_CONFLICT} (→409),
     * distinguished from a genuinely missing / other-tenant / soft-deleted doc ({@code NOT_FOUND} →404)
     * by a failure-path re-query. That re-query re-asserts the SAME tenant predicate (userId + deletedAt)
     * so cross-tenant existence never leaks as a 409. It is a best-effort diagnostic for HTTP-status
     * messaging ONLY — it is not atomic with the update and is never a stronger concurrency guarantee.
     * A null {@code expectedVersion} preserves the legacy unconditioned behavior.
     *
     * <p>Note: Spring's managed {@code OptimisticLockingFailureException} does NOT fire here —
     * {@code updateFirst} bypasses {@code @Version}'s save() check — so both the increment
     * ({@code .inc("version", 1)}) and the precondition ({@code where("version").is(...)}) are manual.
     */
    public SetUpdateResult updateSet(String workoutId, String setId, BigDecimal weight, Integer reps,
                                     Integer rpe, String note, SetType setType, BigDecimal loadDelta,
                                     Long expectedVersion) {
        // Set-existence is part of the match: without it the unconditional .inc("version")/updatedAt below
        // would "modify" the workout (→ modifiedCount>0 → false success) even when the arrayFilter hits no
        // set. Requiring the setId here means a missing set matches nothing → NOT_FOUND, and never a phantom
        // version bump on a workout whose target set does not exist.
        Criteria base = where("_id").is(workoutId)
                .and("userId").is(tenant.userId())
                .and("deletedAt").is(null)
                .and("exercises.sets.setId").is(setId);
        Criteria match = (expectedVersion == null)
                ? base
                : new Criteria().andOperator(base, where("version").is(expectedVersion));
        Update u = new Update().set("updatedAt", Instant.now()).inc("version", 1)
                .filterArray(Criteria.where("s.setId").is(setId));
        if (weight != null)    u.set("exercises.$[].sets.$[s].weight", weight);
        if (reps != null)      u.set("exercises.$[].sets.$[s].reps", reps);
        if (rpe != null)       u.set("exercises.$[].sets.$[s].rpe", rpe);
        if (note != null)      u.set("exercises.$[].sets.$[s].note", note);
        if (setType != null)   u.set("exercises.$[].sets.$[s].setType", setType);
        if (loadDelta != null) u.set("exercises.$[].sets.$[s].loadDelta", loadDelta);

        if (mongo.updateFirst(new Query(match), u, Workout.class).getModifiedCount() > 0) {
            return SetUpdateResult.UPDATED;
        }
        if (expectedVersion == null) return SetUpdateResult.NOT_FOUND;   // legacy path: no version to conflict on

        // Failure-path disambiguation (best-effort, non-atomic): tenant-scoped re-read without the version.
        Workout doc = findOne(workoutId).orElse(null);
        if (doc == null) return SetUpdateResult.NOT_FOUND;              // missing / soft-deleted / other tenant
        boolean setExists = doc.getExercises().stream()
                .flatMap(e -> e.sets().stream())
                .anyMatch(s -> setId.equals(s.setId()));
        return setExists ? SetUpdateResult.VERSION_CONFLICT : SetUpdateResult.NOT_FOUND;
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
