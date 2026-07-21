package com.workoutlogger.repo;

import com.workoutlogger.domain.User;

import java.util.Optional;

/** MongoTemplate-backed atomic ops on the User doc that Spring Data's derived queries can't express.
 *  Implemented by {@code UserRepositoryImpl} and mixed into {@link UserRepository}. */
public interface UserRepositoryCustom {

    /**
     * Atomically reset a password by email: {@code $set passwordHash + updatedAt} and {@code $inc tokenVersion}
     * in ONE {@code findAndModify(returnNew)} — never a read-modify-write {@code save()} of the User doc (M3).
     * Bumping the version revokes every OTHER outstanding token; the caller mints the new session JWT at the
     * returned {@code tokenVersion} so exactly this session survives. Empty ⇒ no account for that email.
     */
    Optional<User> resetPassword(String email, String newPasswordHash);
}
