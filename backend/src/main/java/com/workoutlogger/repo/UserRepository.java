package com.workoutlogger.repo;

import com.workoutlogger.domain.User;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

/** User lookups for authentication (pre-auth, so not tenant-scoped). */
public interface UserRepository extends MongoRepository<User, String> {
    Optional<User> findByEmail(String email);
    boolean existsByEmail(String email);
}
