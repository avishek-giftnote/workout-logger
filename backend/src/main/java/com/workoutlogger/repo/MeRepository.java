package com.workoutlogger.repo;

import com.workoutlogger.domain.BodyweightEntry;
import com.workoutlogger.domain.User;
import com.workoutlogger.security.Tenant;
import org.springframework.data.mongodb.MongoExpression;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/**
 * Tenant-scoped TARGETED ATOMIC writes to the current user's document (audit M3 / DESIGN.md §2a).
 *
 * <p>The User doc's write paths (settings, bodyweightLog, profile) are disjoint subtrees hit by
 * concurrent fire-and-forget clients, so the council ruled OUT a shared {@code @Version} lock (it would
 * 409 writes that never conflict, and the client swallows settings-PUT errors — a 409 there is a silent
 * lost write). Instead every mutation is one atomic {@code updateFirst} keyed on
 * {@code {_id: tenant.userId()}}; MongoDB's single-document atomicity makes concurrent disjoint writes
 * commutative and same-field writes race-safe. Full-document {@code save()} on User is FORBIDDEN outside
 * registration/import — it is the read-modify-write that caused the M3 lost updates.
 *
 * <p>All "did it match" branches use {@code getMatchedCount()}, not {@code getModifiedCount()}: a no-op
 * write (identical values in the same millisecond) matches but modifies nothing, and must not read as
 * not-found.
 */
@Repository
public class MeRepository {

    /** Bodyweight log hard cap — ~10 years of daily weigh-ins; guards the 16 MB doc limit (audit M4). */
    public static final int BODYWEIGHT_LOG_CAP = 3650;

    /** Outcome of an atomic bodyweight append; 3-state so the controller must handle the cap distinctly. */
    public enum AddResult { ADDED, CAP_FULL, NOT_FOUND }

    private final MongoTemplate mongo;
    private final Tenant tenant;

    public MeRepository(MongoTemplate mongo, Tenant tenant) {
        this.mongo = mongo;
        this.tenant = tenant;
    }

    private Query owned() {
        return new Query(where("_id").is(tenant.userId()));
    }

    /** Pure read — never writes (the legacy backfill-on-read was an M3 racer; it moved to startup). */
    public Optional<User> find() {
        return Optional.ofNullable(mongo.findOne(owned(), User.class));
    }

    /**
     * Atomic settings LWW: one conditional update whose match embeds the "incoming is newest" check
     * ({@code settingsUpdatedAt <= incoming} — ties still write, preserving the legacy {@code >=}).
     * A superseded write matches nothing and is a silent no-op (LWW semantics; never a 409).
     *
     * @return true when this write won (matched), false when superseded or the user is missing.
     */
    public boolean putSettingsIfNewer(Map<String, String> settings, long incoming) {
        Query q = owned().addCriteria(where("settingsUpdatedAt").lte(incoming));
        Update u = new Update().set("settings", settings)
                .set("settingsUpdatedAt", incoming)
                .set("updatedAt", Instant.now());
        return mongo.updateFirst(q, u, User.class).getMatchedCount() > 0;
    }

    /** Atomic append with the cap INSIDE the match ($expr $size) — closes the check-then-act TOCTOU where
     *  concurrent adds at the boundary all passed the in-memory size check. */
    public AddResult addBodyweight(BodyweightEntry entry) {
        Query q = owned().addCriteria(Criteria.expr(MongoExpression.create(
                "{ $lt: [ { $size: { $ifNull: ['$bodyweightLog', []] } }, " + BODYWEIGHT_LOG_CAP + " ] }")));
        Update u = new Update().push("bodyweightLog", entry).set("updatedAt", Instant.now())
                .unset("currentBodyweightKg");   // see clearLegacyMirror note below
        if (mongo.updateFirst(q, u, User.class).getMatchedCount() > 0) return AddResult.ADDED;
        return mongo.exists(owned(), User.class) ? AddResult.CAP_FULL : AddResult.NOT_FOUND;
    }

    /**
     * Atomic single-entry amend via the positional {@code $} operator. The entry id is part of the MATCH
     * (not just the update), so a missing id matches nothing — no phantom {@code updatedAt} bump falsely
     * reporting success (the updateSet set-existence lesson). Null weight/when keep the stored values;
     * an amended entry always becomes a real measurement ({@code estimated=false}).
     */
    public boolean amendBodyweight(String entryId, BigDecimal weightKg, Instant recordedAt) {
        Query q = owned().addCriteria(where("bodyweightLog.entryId").is(entryId));
        Update u = new Update().set("bodyweightLog.$.estimated", false).set("updatedAt", Instant.now())
                .unset("currentBodyweightKg");
        if (weightKg != null)   u.set("bodyweightLog.$.weightKg", weightKg);
        if (recordedAt != null) u.set("bodyweightLog.$.recordedAt", recordedAt);
        return mongo.updateFirst(q, u, User.class).getMatchedCount() > 0;
    }

    /** Atomic single-entry delete ($pull). Entry id stays in the match for the same no-phantom-bump reason. */
    public boolean deleteBodyweight(String entryId) {
        Query q = owned().addCriteria(where("bodyweightLog.entryId").is(entryId));
        Update u = new Update().set("updatedAt", Instant.now()).unset("currentBodyweightKg");
        u.pull("bodyweightLog", new org.bson.Document("entryId", entryId));
        return mongo.updateFirst(q, u, User.class).getMatchedCount() > 0;
    }

    // clearLegacyMirror — every bodyweight write $unsets the legacy currentBodyweightKg mirror IN THE SAME
    // atomic update (not a recompute — no read-modify-write). This exactly reproduces the old
    // recomputeCurrent lifecycle: an import-era account keeps its mirror (the user-supplied import weight)
    // as the read-time fallback UNTIL its first bodyweight write; from then on the value is purely derived,
    // so deleting the last real weigh-in yields null — never a resurrected years-stale import weight
    // (review-council finding: the mirror IS stale-able once writes stop maintaining it, so writes retire it).

    /**
     * Per-field profile {@code $set} in one atomic update ({@code $set} auto-vivifies the embedded
     * profile), so concurrent updates to DIFFERENT profile fields can no longer clobber each other.
     * {@code fields} maps profile property → new value (already parsed/converted by the controller).
     *
     * <p>{@code initialIntakeAt} is set-once: when requested, a SECOND conditional update sets it only if
     * absent. The pair is atomic per-op but not as a unit — a reader between the two sees kcal without the
     * anchor, and a crash between them leaves kcal set with no anchor until the NEXT kcal-bearing PUT
     * (nothing reconciles in the background; the field is write-only today). Accepted residual, documented
     * in DESIGN.md §2a; strictly better than the old read-modify-write, which had the same window with
     * zero atomicity.
     *
     * @return true when the user doc was matched.
     */
    public boolean updateProfileFields(Map<String, Object> fields, boolean setInitialIntakeAtIfAbsent) {
        Instant now = Instant.now();
        Update u = new Update().set("profile.updatedAt", now).set("updatedAt", now);
        fields.forEach((k, v) -> u.set("profile." + k, v));
        boolean matched = mongo.updateFirst(owned(), u, User.class).getMatchedCount() > 0;
        if (matched && setInitialIntakeAtIfAbsent) {
            mongo.updateFirst(owned().addCriteria(where("profile.initialIntakeAt").exists(false)),
                    new Update().set("profile.initialIntakeAt", now), User.class);
        }
        return matched;
    }
}
