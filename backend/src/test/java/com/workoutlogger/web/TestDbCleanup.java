package com.workoutlogger.web;

import org.springframework.data.mongodb.core.MongoTemplate;

/**
 * Drop a run's throwaway test database on suite teardown so Atlas runs stop accumulating leaked
 * {@code workoutlogger_*} databases (see docs/db-situation.md). CI's {@code mongo:7} service container is
 * ephemeral and doesn't need this; the leak was only ever from Atlas runs that named an isolated DB per
 * run and never dropped it.
 *
 * <p>Safety guard: only a database whose name starts with {@code workoutlogger_} is dropped — never the
 * bare {@code workoutlogger} dev/demo DB, and never a system DB ({@code admin}/{@code local}). So even if
 * {@code MONGODB_TEST_URI} is mis-pointed at the dev DB, teardown is a no-op rather than data loss.
 */
final class TestDbCleanup {

    private TestDbCleanup() {}

    static void dropIfTestDatabase(MongoTemplate mongo) {
        if (mongo == null) return;
        String name = mongo.getDb().getName();
        if (name.startsWith("workoutlogger_")) {
            mongo.getDb().drop();
        }
    }
}
