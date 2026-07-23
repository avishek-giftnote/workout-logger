package com.workoutlogger.repo;

import com.workoutlogger.domain.User;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;

import java.util.Optional;

/** User lookups for authentication (pre-auth, so not tenant-scoped). */
public interface UserRepository extends MongoRepository<User, String> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);

    /** Projection loading only {@code _id + tokenVersion} — the per-request revocation check on the auth
     *  hot path (see JwtAuthenticationFilter). Empty ⇒ the user no longer exists (e.g. wiped) ⇒ reject. */
    @Query(value = "{ '_id': ?0 }", fields = "{ 'tokenVersion': 1 }")
    Optional<User> findTokenVersionById(String id);
}
