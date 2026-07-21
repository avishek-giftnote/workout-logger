package com.workoutlogger.repo;

import com.workoutlogger.domain.AuthChallenge;
import com.workoutlogger.domain.AuthChallenge.Purpose;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/**
 * Pre-auth store for {@link AuthChallenge} (keyed by {email, purpose} — NOT tenant-scoped: there is no user
 * yet). Every mutation is a single ATOMIC {@code findAndModify} — never a read-modify-write {@code save()} of
 * the shared doc (the codebase's M3 invariant): concurrent verifies must not lost-update the attempt counter
 * and bypass the lockout, and concurrent requests must not both read a stale send count and blow the cap.
 */
@Repository
public class AuthChallengeRepository {

    private final MongoTemplate mongo;

    public AuthChallengeRepository(MongoTemplate mongo) {
        this.mongo = mongo;
    }

    private static Query keyed(String email, Purpose purpose) {
        return new Query(where("email").is(email).and("purpose").is(purpose));
    }

    public Optional<AuthChallenge> find(String email, Purpose purpose) {
        return Optional.ofNullable(mongo.findOne(keyed(email, purpose), AuthChallenge.class));
    }

    /**
     * Atomically claim ONE verify attempt against a live, unlocked SIGNUP challenge: match {email, purpose,
     * not expired, attempts &lt; max, code present} and {@code $inc attempts}. Returns the (post-increment) doc
     * iff a slot was claimed — so N concurrent wrong guesses consume N attempts (bounded at max), never
     * lost-update to ~1. Empty ⇒ absent / expired / already locked.
     */
    public Optional<AuthChallenge> claimSignupAttempt(String email, Instant now, int maxAttempts) {
        Query q = new Query(where("email").is(email).and("purpose").is(Purpose.SIGNUP)
                .and("expiresAt").gt(now).and("attempts").lt(maxAttempts).and("codeHash").exists(true));
        return Optional.ofNullable(mongo.findAndModify(q, new Update().inc("attempts", 1),
                FindAndModifyOptions.options().returnNew(true), AuthChallenge.class));
    }

    /**
     * Atomically bump the per-email send counter within a rolling window and return the effective count. The
     * {@code $inc} is atomic (no lost-update), so concurrent requests can't both read a stale count; a stale
     * window is reset in a second atomic step (a benign boundary race at worst). Upserts the row on first send.
     */
    public int incrementSend(String email, Purpose purpose, Instant now, Instant windowCutoff) {
        AuthChallenge after = mongo.findAndModify(keyed(email, purpose),
                new Update().inc("sends", 1)
                        .setOnInsert("email", email).setOnInsert("purpose", purpose)
                        .setOnInsert("windowStartAt", now).setOnInsert("createdAt", now).setOnInsert("attempts", 0),
                FindAndModifyOptions.options().upsert(true).returnNew(true), AuthChallenge.class);
        if (after.getWindowStartAt() != null && after.getWindowStartAt().isBefore(windowCutoff)) {
            AuthChallenge reset = mongo.findAndModify(
                    new Query(where("email").is(email).and("purpose").is(purpose).and("windowStartAt").lt(windowCutoff)),
                    new Update().set("sends", 1).set("windowStartAt", now),
                    FindAndModifyOptions.options().returnNew(true), AuthChallenge.class);
            if (reset != null) return reset.getSends();
        }
        return after.getSends();
    }

    /** Atomically set a fresh code on the (already send-counted) challenge, resetting the attempt counter. */
    public void setSignupCode(String email, Purpose purpose, String codeHash, Instant expiresAt, Instant now) {
        mongo.findAndModify(keyed(email, purpose),
                new Update().set("codeHash", codeHash).set("expiresAt", expiresAt).set("attempts", 0).set("createdAt", now),
                FindAndModifyOptions.options().returnNew(true), AuthChallenge.class);
    }

    /** Single-use consume: remove the challenge so a code/token can never be replayed. */
    public void consume(String email, Purpose purpose) {
        mongo.remove(keyed(email, purpose), AuthChallenge.class);
    }
}
