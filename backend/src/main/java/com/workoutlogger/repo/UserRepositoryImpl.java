package com.workoutlogger.repo;

import com.workoutlogger.domain.User;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import java.time.Instant;
import java.util.Optional;

import static org.springframework.data.mongodb.core.query.Criteria.where;

/** Fragment implementation for {@link UserRepositoryCustom}. Spring Data wires this into {@link UserRepository}
 *  by the {@code Impl} naming convention. */
public class UserRepositoryImpl implements UserRepositoryCustom {

    private final MongoTemplate mongo;

    public UserRepositoryImpl(MongoTemplate mongo) {
        this.mongo = mongo;
    }

    @Override
    public Optional<User> resetPassword(String email, String newPasswordHash) {
        Instant now = Instant.now();
        Update u = new Update()
                .set("passwordHash", newPasswordHash)
                .set("updatedAt", now)
                .inc("tokenVersion", 1);
        return Optional.ofNullable(mongo.findAndModify(
                new Query(where("email").is(email)), u,
                FindAndModifyOptions.options().returnNew(true), User.class));
    }
}
