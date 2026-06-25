package com.workoutlogger.repo;

import com.workoutlogger.domain.Macrocycle;
import com.workoutlogger.domain.Mesocycle;
import com.workoutlogger.security.Tenant;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/** Tenant-scoped access to the user's training plan (one ACTIVE macrocycle at a time). */
@Repository
public class PlanRepository {

    private final MongoTemplate mongo;
    private final Tenant tenant;

    public PlanRepository(MongoTemplate mongo, Tenant tenant) {
        this.mongo = mongo;
        this.tenant = tenant;
    }

    private Query active() {
        return new Query(where("userId").is(tenant.userId()).and("status").is("ACTIVE"));
    }

    public Optional<Macrocycle> findActive() {
        return Optional.ofNullable(mongo.findOne(active(), Macrocycle.class));
    }

    /** Replaces any existing active plan with a new one. */
    public Macrocycle create(String name, List<Mesocycle> mesocycles, String goal,
                             java.time.LocalDate targetDate, List<com.workoutlogger.domain.Muscle> focusMuscles,
                             String splitId) {
        // Replacing an active plan is an early end, not a completion — mark it ENDED so it doesn't
        // surface in history as a falsely-celebrated COMPLETED plan. (terminal-state split)
        mongo.updateMulti(active(),
                new org.springframework.data.mongodb.core.query.Update()
                        .set("status", "ENDED").set("endedAt", Instant.now()), Macrocycle.class);
        Instant now = Instant.now();
        Macrocycle m = new Macrocycle();
        m.setId(new ObjectId().toHexString());
        m.setUserId(tenant.userId());
        m.setName(name);
        m.setMesocycles(mesocycles);
        m.setGoal(goal);
        m.setTargetDate(targetDate);
        m.setFocusMuscles(focusMuscles);
        m.setSplitId(splitId);
        m.setStartedAt(now);
        m.setCreatedAt(now);
        m.setUpdatedAt(now);
        return mongo.insert(m);
    }

    private Macrocycle save(Macrocycle m) {
        m.setUpdatedAt(Instant.now());
        return mongo.save(m);
    }

    /** Advances the cursor one microcycle: week++ rolling into deload, then into the next mesocycle. */
    public Optional<Macrocycle> advance() {
        return findActive().map(m -> {
            Mesocycle cur = m.getMesocycles().get(m.getMesoIndex());
            // Clamp here too (not only at the controller edge) so a persisted/legacy/importer doc with
            // accumulationWeeks ≤ 0 can't make deloadWeek ≤ 1 and silently skip the whole block. (council SM2)
            int deloadWeek = Math.max(1, cur.accumulationWeeks()) + 1;
            if (m.getWeek() < deloadWeek) {
                m.setWeek(m.getWeek() + 1);
            } else if (m.getMesoIndex() + 1 < m.getMesocycles().size()) {
                m.setMesoIndex(m.getMesoIndex() + 1);
                m.setWeek(1);
            } else {
                m.setStatus("COMPLETED");
                m.setCompletedAt(Instant.now());
            }
            return save(m);
        });
    }

    public Optional<Macrocycle> addMesocycle(Mesocycle meso) {
        return findActive().map(m -> {
            m.getMesocycles().add(meso);
            return save(m);
        });
    }

    public boolean endActive() {
        return mongo.updateMulti(active(),
                new org.springframework.data.mongodb.core.query.Update()
                        .set("status", "ENDED")
                        .set("endedAt", Instant.now()),
                Macrocycle.class).getModifiedCount() > 0;
    }

    /** Returns all COMPLETED and ENDED plans for this tenant, sorted newest-first by startedAt. */
    public List<Macrocycle> findTerminal() {
        Query q = new Query(where("userId").is(tenant.userId())
                .and("status").in("COMPLETED", "ENDED"))
                .with(org.springframework.data.domain.Sort.by(
                        org.springframework.data.domain.Sort.Direction.DESC, "startedAt"));
        return mongo.find(q, Macrocycle.class);
    }
}
