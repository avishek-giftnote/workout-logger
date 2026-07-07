package com.workoutlogger.web;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Proves the auth rate limiter (audit finding C2): with the limiter ENABLED and a small capacity, a burst
 * of identical {@code POST /api/auth/login} from one IP must let the first {@code capacity} through (they
 * fail on credentials, never on throttling) and 429 a subsequent one with the standard error envelope.
 *
 * <p>Sibling {@link ApiIntegrationTest} disables the limiter (its concurrent-register burst shares one IP);
 * this class is the dedicated guard that the limiter actually fires. Gated by RUN_MONGO_TESTS=1 because it
 * boots the full application context.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.data.mongodb.uri=${MONGODB_TEST_URI:mongodb://localhost:27017/workoutlogger_test}",
        "security.ratelimit.enabled=true",
        "security.ratelimit.capacity=3",
        "security.ratelimit.window-seconds=60"})
@EnabledIfEnvironmentVariable(named = "RUN_MONGO_TESTS", matches = "1")
class RateLimitIntegrationTest {

    private static final int CAPACITY = 3;

    @Autowired
    MockMvc mvc;
    @org.springframework.beans.factory.annotation.Autowired
    org.springframework.data.mongodb.core.MongoTemplate mongo;

    private static org.springframework.data.mongodb.core.MongoTemplate dropRef;

    @org.junit.jupiter.api.BeforeEach
    void captureDropRef() { dropRef = mongo; }

    @org.junit.jupiter.api.AfterAll
    static void dropTestDatabase() {
        TestDbCleanup.dropIfTestDatabase(dropRef);   // don't leak the run's workoutlogger_* DB (docs/db-situation.md)
    }

    @Test
    void loginBurstFromOneIpIsThrottledWith429() throws Exception {
        // Dummy credentials for a login that is expected to fail auth (never a real secret).
        String body = "{\"email\":\"attacker@example.com\",\"password\":\"wrongpass1\"}"; // pragma: allowlist secret

        // The first `capacity` requests must NOT be 429 — they reach the controller and fail auth (401).
        for (int i = 0; i < CAPACITY; i++) {
            mvc.perform(post("/api/auth/login")
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isUnauthorized());
        }

        // The next request from the same IP exceeds capacity within the window → 429 + the error envelope.
        mvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.status").value(429))
                .andExpect(jsonPath("$.error").value("Too Many Requests"))
                .andExpect(jsonPath("$.message").value("Too many requests — slow down."))
                .andExpect(jsonPath("$.timestamp").exists());
    }
}
