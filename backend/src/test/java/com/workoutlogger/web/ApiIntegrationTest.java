package com.workoutlogger.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * End-to-end API test. Requires a local MongoDB and is gated by RUN_MONGO_TESTS=1 so the default
 * `mvn test` (no DB) stays green. Run: RUN_MONGO_TESTS=1 mvn test
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "spring.data.mongodb.uri=${MONGODB_TEST_URI:mongodb://localhost:27017/workoutlogger_test}",
        // The auth rate limiter keys by IP; every MockMvc request shares 127.0.0.1, so the concurrent-register
        // burst below would trip a 429. Disable it here — RateLimitIntegrationTest covers the limiter on its own.
        "security.ratelimit.enabled=false"})
@EnabledIfEnvironmentVariable(named = "RUN_MONGO_TESTS", matches = "1")
class ApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired MongoTemplate mongo;
    @Autowired ObjectMapper json;
    @Autowired com.workoutlogger.config.BodyweightEntryIdBackfillRunner backfill;

    private static MongoTemplate dropRef;

    @BeforeEach
    void clean() {
        dropRef = mongo;   // capture for the static @AfterAll teardown
        for (String c : new String[]{"users", "workouts", "exercises", "templates", "splits", "plans"}) {
            mongo.getDb().getCollection(c).deleteMany(new org.bson.Document());
        }
    }

    @org.junit.jupiter.api.AfterAll
    static void dropTestDatabase() {
        TestDbCleanup.dropIfTestDatabase(dropRef);   // don't leak the run's workoutlogger_* DB (docs/db-situation.md)
    }

    private String register(String email) throws Exception {
        String body = """
            {"email":"%s","password":"password123"}""".formatted(email);
        String res = mvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(res).get("token").asText();
    }

    private String bearer(String t) { return "Bearer " + t; }

    @Test
    void unauthenticatedRequestsAreRejected() throws Exception {
        mvc.perform(get("/api/workouts")).andExpect(status().isUnauthorized());
    }

    /**
     * Single-JAR deploy posture: the actuator health probe is public (Fly's health check), the API
     * stays JWT-protected, and extensionless SPA routes are permitted + forwarded to index.html so a
     * deep link / hard refresh does not 404.
     */
    @Test
    void healthIsPublicApiStaysProtectedAndSpaRoutesForward() throws Exception {
        // Fly health check: /actuator/health is permitAll and returns 200 (only health is exposed).
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());

        // The API surface remains protected — no token still yields 401.
        mvc.perform(get("/api/workouts")).andExpect(status().isUnauthorized());

        // An extensionless client-side route (no token) is permitted and forwards to the SPA shell:
        // not 401/403, and resolves to the test index.html placeholder (200).
        mvc.perform(get("/start")).andExpect(status().isOk());

        // A nested deep link (e.g. /previous-workouts/{id}) also forwards rather than 404-ing.
        mvc.perform(get("/previous-workouts/abc123")).andExpect(status().isOk());
    }

    @Test
    void usersCannotSeeEachOthersWorkouts() throws Exception {
        String tokenA = register("a@example.com");
        String tokenB = register("b@example.com");

        // A creates an exercise + a workout referencing it.
        String exId = json.readTree(mvc.perform(post("/api/exercises").header("Authorization", bearer(tokenA))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Bench Press (Barbell)\",\"isBodyweight\":false}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString())
                .get("id").asText();

        String workoutBody = """
            {"startedAt":"2026-06-01T10:00:00Z","exercises":[
               {"exerciseId":"%s","name":"Bench Press (Barbell)","position":0,"sets":[
                  {"orderIndex":0,"setType":"WORKING","weight":"60.0","reps":5}]}]}""".formatted(exId);
        String created = mvc.perform(post("/api/workouts").header("Authorization", bearer(tokenA))
                        .contentType(MediaType.APPLICATION_JSON).content(workoutBody))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String workoutId = json.readTree(created).get("id").asText();

        // A sees it; B does not (404), and B's list is empty.
        mvc.perform(get("/api/workouts/" + workoutId).header("Authorization", bearer(tokenA)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/workouts/" + workoutId).header("Authorization", bearer(tokenB)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/workouts").header("Authorization", bearer(tokenB)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void lastWorkingSetIsDeterministicAndExcludesWarmups() throws Exception {
        String token = register("c@example.com");
        String exId = json.readTree(mvc.perform(post("/api/exercises").header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Squat (Barbell)\",\"isBodyweight\":false}"))
                .andReturn().getResponse().getContentAsString()).get("id").asText();

        // One session, all sets share startedAt: warmup 20, working 50 (idx1), working 55 (idx2).
        String body = """
            {"startedAt":"2026-06-02T18:00:00Z","exercises":[
               {"exerciseId":"%s","name":"Squat (Barbell)","position":0,"sets":[
                  {"orderIndex":0,"setType":"WARMUP","weight":"20.0","reps":5},
                  {"orderIndex":1,"setType":"WORKING","weight":"50.0","reps":5},
                  {"orderIndex":2,"setType":"WORKING","weight":"55.0","reps":5}]}]}""".formatted(exId);
        mvc.perform(post("/api/workouts").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isCreated());

        // Must return the last WORKING set (idx 2, weight 55) — never the warmup, deterministically.
        mvc.perform(get("/api/exercises/" + exId + "/last-working-set").header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weight").value("55.0"))
                .andExpect(jsonPath("$.orderIndex").value(2));
    }

    // ── helpers ──
    private String createExercise(String token, String name, boolean bw) throws Exception {
        String body = "{\"name\":\"" + name + "\",\"isBodyweight\":" + bw + "}";
        return id(mvc.perform(post("/api/exercises").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getContentAsString());
    }
    private String createTemplate(String token, String name, String exId) throws Exception {
        String body = "{\"name\":\"" + name + "\",\"exercises\":[{\"exerciseId\":\"" + exId + "\",\"name\":\"x\",\"position\":0,\"sets\":3}]}";
        return id(mvc.perform(post("/api/templates").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getContentAsString());
    }
    private String createWorkout(String token, String exId, String weight, int reps) throws Exception {
        String body = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + exId
                + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"" + weight
                + "\",\"reps\":" + reps + "}]}]}";
        return id(mvc.perform(post("/api/workouts").header("Authorization", bearer(token))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getContentAsString());
    }
    private String id(String resBody) throws Exception { return json.readTree(resBody).get("id").asText(); }

    @Test
    void workoutCapturesSoreMuscles() throws Exception {
        String t = register("sore@example.com");
        String ex = createExercise(t, "Incline Press X", false);
        String body = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"soreMuscles\":[\"CHEST\",\"TRICEP\"],\"exercises\":[{\"exerciseId\":\""
                + ex + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"50\",\"reps\":8}]}]}";
        String wid = id(mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getContentAsString());
        mvc.perform(get("/api/workouts/" + wid).header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.soreMuscles.length()").value(2))
                .andExpect(jsonPath("$.soreMuscles[0]").value("CHEST"));
    }

    @Test
    void workoutEditAppliesDeloadAndSoreness() throws Exception {
        String t = register("wedit@example.com");
        String ex = createExercise(t, "Edit Press", false);
        String wid = createWorkout(t, ex, "50", 8);
        String body = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"cyclePhase\":\"DELOAD\",\"soreMuscles\":[\"CHEST\"],\"exercises\":[{\"exerciseId\":\""
                + ex + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"55\",\"reps\":8}]}]}";
        mvc.perform(put("/api/workouts/" + wid).header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(jsonPath("$.cyclePhase").value("DELOAD"))
                .andExpect(jsonPath("$.soreMuscles[0]").value("CHEST"));
        String cleared = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"exercises\":[{\"exerciseId\":\""
                + ex + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"55\",\"reps\":8}]}]}";
        mvc.perform(put("/api/workouts/" + wid).header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(cleared))
                .andExpect(jsonPath("$.cyclePhase").doesNotExist());   // edit can clear a mis-marked deload
    }

    @Test
    void inputHardeningReturns400NotFiveHundred() throws Exception {
        String t = register("harden@example.com");
        String ex = createExercise(t, "Harden Lift", false);
        String bad = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"abc\",\"reps\":8}]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(bad))
                .andExpect(status().isBadRequest());                    // malformed decimal → 400, not 500
        String wid = createWorkout(t, ex, "50", 8);
        String me = mvc.perform(get("/api/workouts/" + wid).header("Authorization", bearer(t))).andReturn().getResponse().getContentAsString();
        String sid = json.readTree(me).get("exercises").get(0).get("sets").get(0).get("id").asText();
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"rpe\":99}"))
                .andExpect(status().isBadRequest());                    // rpe out of 1..10 → 400
        String plan = "{\"name\":\"P\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":4,\"phase\":\"SURPLUS\",\"focusMuscles\":[],"
                + "\"intensityBand\":{\"repLow\":12,\"repHigh\":8,\"targetRir\":\"2\",\"pctLow\":null,\"pctHigh\":null}}]}";
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(plan))
                .andExpect(status().isBadRequest());                    // repLow > repHigh → 400
    }

    // ── updateSet optimistic lock (@Version / If-Match, 409-on-stale) — Phase-0 sync hardening ──
    // Deciding-council contract (docs/sync-architecture-council.md + the updateSet council):
    // version rides the If-Match header (optional, enforced-when-present); a stale write → 409 with the
    // server's current copy in .detail; missing/other-tenant/soft-deleted/set-missing → 404 (never a
    // misleading 409, never a tenant-existence leak); version is exposed read-only on WorkoutDto.
    private JsonNode getWorkout(String token, String wid) throws Exception {
        return json.readTree(mvc.perform(get("/api/workouts/" + wid).header("Authorization", bearer(token)))
                .andReturn().getResponse().getContentAsString());
    }
    private String firstSetId(JsonNode w) { return w.get("exercises").get(0).get("sets").get(0).get("id").asText(); }

    @Test
    void workoutDtoExposesVersionAndItRoundTrips() throws Exception {
        String t = register("ver@example.com");
        String ex = createExercise(t, "Ver Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        JsonNode w = getWorkout(t, wid);
        assertThat(w.get("version").isNumber()).isTrue();               // exposed as a plain JSON number
        long v0 = w.get("version").asLong();
        String put = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"55\",\"reps\":8}]}]}";
        long v1 = json.readTree(mvc.perform(put("/api/workouts/" + wid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(put)).andReturn().getResponse().getContentAsString())
                .get("version").asLong();
        assertThat(v1).isGreaterThan(v0);                              // a full PUT (save) bumps @Version
    }

    @Test
    void setUpdateWithMatchingVersionSucceedsAndBumps() throws Exception {
        String t = register("match@example.com");
        String ex = createExercise(t, "Match Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        JsonNode w = getWorkout(t, wid);
        long v = w.get("version").asLong();
        String sid = firstSetId(w);
        String res = mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", String.valueOf(v))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reps\":10}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode after = json.readTree(res);
        assertThat(after.get("version").asLong()).isEqualTo(v + 1);
        assertThat(after.get("exercises").get(0).get("sets").get(0).get("reps").asInt()).isEqualTo(10);
    }

    @Test
    void setUpdateWithStaleVersionReturns409WithCurrentCopy() throws Exception {
        String t = register("stale@example.com");
        String ex = createExercise(t, "Stale Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        JsonNode w = getWorkout(t, wid);
        long v = w.get("version").asLong();
        String sid = firstSetId(w);
        // first write with the current version succeeds and bumps to v+1
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", String.valueOf(v)).contentType(MediaType.APPLICATION_JSON).content("{\"reps\":9}"))
                .andExpect(status().isOk());
        // second write still carrying the ORIGINAL (now stale) version → 409, body.detail = server's current copy
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", String.valueOf(v)).contentType(MediaType.APPLICATION_JSON).content("{\"reps\":12}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail.version").value((int) (v + 1)))
                .andExpect(jsonPath("$.detail.exercises[0].sets[0].reps").value(9));   // stale write did NOT apply
    }

    @Test
    void setUpdateWithoutIfMatchPreservesCurrentBehavior() throws Exception {
        String t = register("noif@example.com");
        String ex = createExercise(t, "NoIf Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        JsonNode w = getWorkout(t, wid);
        long v = w.get("version").asLong();
        String sid = firstSetId(w);
        String res = mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reps\":11}"))   // no If-Match
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(res).get("version").asLong()).isEqualTo(v + 1);   // unconditioned update still increments
    }

    @Test
    void setUpdateOnMissingWorkoutReturns404() throws Exception {
        String t = register("missing@example.com");
        mvc.perform(patch("/api/workouts/000000000000000000000000/sets/nope").header("Authorization", bearer(t))
                        .header("If-Match", "0").contentType(MediaType.APPLICATION_JSON).content("{\"reps\":5}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void setUpdateCrossTenantReturns404NotConflict() throws Exception {
        String a = register("ta@example.com");
        String b = register("tb@example.com");
        String ex = createExercise(a, "A Lift", false);
        String wid = createWorkout(a, ex, "50", 8);
        JsonNode w = getWorkout(a, wid);
        long v = w.get("version").asLong();
        String sid = firstSetId(w);
        // B, holding A's real version, must get 404 (never 409, never 200) — no cross-tenant existence leak.
        // Also assert the body carries NO `detail`: a 409 attaches the current WorkoutDto, so its absence proves
        // the response is indistinguishable from a genuine not-found and never leaks A's document to B.
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(b))
                        .header("If-Match", String.valueOf(v)).contentType(MediaType.APPLICATION_JSON).content("{\"reps\":7}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").doesNotExist());
    }

    @Test
    void setUpdateOnLegacyNullVersionDocBehavesOnWritePath() throws Exception {
        String t = register("legacywrite@example.com");
        String ex = createExercise(t, "LegacyWrite Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        String sid = firstSetId(getWorkout(t, wid));
        // strip the version field → a pre-@Version legacy doc (via MongoTemplate so the String @Id → ObjectId _id)
        mongo.updateFirst(
                new org.springframework.data.mongodb.core.query.Query(
                        org.springframework.data.mongodb.core.query.Criteria.where("_id").is(wid)),
                new org.springframework.data.mongodb.core.query.Update().unset("version"),
                com.workoutlogger.domain.Workout.class);
        // (a) If-Match "0" against an ABSENT version field → 409: Mongo {version:0} does not match a missing field.
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", "0").contentType(MediaType.APPLICATION_JSON).content("{\"reps\":9}"))
                .andExpect(status().isConflict());
        // (b) no header → unconditioned update seeds the absent field: $inc(version,1) → 1.
        String res = mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reps\":10}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(res).get("version").asLong()).isEqualTo(1L);
    }

    @Test
    void setUpdateOnSoftDeletedWorkoutReturns404() throws Exception {
        String t = register("del@example.com");
        String ex = createExercise(t, "Del Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        JsonNode w = getWorkout(t, wid);
        long v = w.get("version").asLong();
        String sid = firstSetId(w);
        mvc.perform(delete("/api/workouts/" + wid).header("Authorization", bearer(t))).andExpect(status().isNoContent());
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", String.valueOf(v)).contentType(MediaType.APPLICATION_JSON).content("{\"reps\":6}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void setUpdateWithCurrentVersionButMissingSetReturns404() throws Exception {
        String t = register("noset@example.com");
        String ex = createExercise(t, "NoSet Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        long v = getWorkout(t, wid).get("version").asLong();
        mvc.perform(patch("/api/workouts/" + wid + "/sets/deadbeef").header("Authorization", bearer(t))
                        .header("If-Match", String.valueOf(v)).contentType(MediaType.APPLICATION_JSON).content("{\"reps\":6}"))
                .andExpect(status().isNotFound());   // set genuinely missing → 404, NOT a version conflict
    }

    @Test
    void setUpdateMalformedIfMatchReturns400() throws Exception {
        String t = register("badif@example.com");
        String ex = createExercise(t, "BadIf Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        String sid = firstSetId(getWorkout(t, wid));
        mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", "not-a-number").contentType(MediaType.APPLICATION_JSON).content("{\"reps\":6}"))
                .andExpect(status().isBadRequest());   // non-numeric If-Match → 400, not 500
    }

    @Test
    void setUpdateResponseKeepsDecimalsAsStrings() throws Exception {
        String t = register("decstr@example.com");
        String ex = createExercise(t, "Dec Lift", false);
        String wid = createWorkout(t, ex, "42.25", 8);
        JsonNode w = getWorkout(t, wid);
        long v = w.get("version").asLong();
        String sid = firstSetId(w);
        String res = mvc.perform(patch("/api/workouts/" + wid + "/sets/" + sid).header("Authorization", bearer(t))
                        .header("If-Match", String.valueOf(v)).contentType(MediaType.APPLICATION_JSON).content("{\"weight\":\"43.75\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        JsonNode set = json.readTree(res).get("exercises").get(0).get("sets").get(0);
        assertThat(set.get("weight").isTextual()).isTrue();            // weight stays a decimal STRING, not a number
        assertThat(set.get("weight").asText()).isEqualTo("43.75");
    }

    @Test
    void legacyNullVersionSerializesAsNull() throws Exception {
        String t = register("legacy@example.com");
        String ex = createExercise(t, "Legacy Lift", false);
        String wid = createWorkout(t, ex, "50", 8);
        // simulate a pre-@Version document: strip the version field. Go through MongoTemplate so the String
        // @Id is converted to the stored ObjectId _id (a raw collection filter on the String id would no-op).
        mongo.updateFirst(
                new org.springframework.data.mongodb.core.query.Query(
                        org.springframework.data.mongodb.core.query.Criteria.where("_id").is(wid)),
                new org.springframework.data.mongodb.core.query.Update().unset("version"),
                com.workoutlogger.domain.Workout.class);
        JsonNode w = getWorkout(t, wid);
        assertThat(w.get("version") == null || w.get("version").isNull()).isTrue();   // null, never coerced to 0
    }

    @Test
    void templateCreateUpdateGet() throws Exception {
        String t = register("t@example.com");
        String ex = createExercise(t, "Row (Cable)", false);
        String tid = createTemplate(t, "Pull", ex);   // legacy shape (no reps/targetRir) still valid
        String upd = "{\"name\":\"Pull\",\"exercises\":[{\"exerciseId\":\"" + ex + "\",\"name\":\"Row\",\"position\":0,\"sets\":5,\"reps\":8,\"targetRir\":\"2\"}]}";
        mvc.perform(put("/api/templates/" + tid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(upd))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exercises[0].sets").value(5))
                .andExpect(jsonPath("$.exercises[0].reps").value(8))          // prescription round-trips
                .andExpect(jsonPath("$.exercises[0].targetRir").value("2"));
        mvc.perform(get("/api/templates").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].exercises[0].reps").value(8));
    }

    @Test
    void splitCreateUpdateDeleteWithIsolation() throws Exception {
        String a = register("spa@example.com");
        String b = register("spb@example.com");
        String ex = createExercise(a, "A", false);
        String t1 = createTemplate(a, "T1", ex), t2 = createTemplate(a, "T2", ex);
        String sid = id(mvc.perform(post("/api/splits").header("Authorization", bearer(a))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"AP\",\"templateIds\":[\"" + t1 + "\",\"" + t2 + "\"]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString());
        mvc.perform(put("/api/splits/" + sid).header("Authorization", bearer(a))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"AP\",\"templateIds\":[\"" + t1 + "\"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.templateIds.length()").value(1));
        mvc.perform(delete("/api/splits/" + sid).header("Authorization", bearer(b))).andExpect(status().isNotFound());
        mvc.perform(delete("/api/splits/" + sid).header("Authorization", bearer(a))).andExpect(status().isNoContent());
        mvc.perform(get("/api/splits").header("Authorization", bearer(a))).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void workoutEditDeleteAndIsolation() throws Exception {
        String a = register("wa@example.com");
        String b = register("wb@example.com");
        String ex = createExercise(a, "Curl (Dumbbell)", false);
        String wid = createWorkout(a, ex, "40", 10);
        String edit = "{\"startedAt\":\"2026-06-03T10:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"Curl\",\"position\":0,\"sets\":["
                + "{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"45\",\"reps\":8},"
                + "{\"orderIndex\":1,\"setType\":\"WORKING\",\"weight\":\"45\",\"reps\":7}]}]}";
        mvc.perform(put("/api/workouts/" + wid).header("Authorization", bearer(a))
                        .contentType(MediaType.APPLICATION_JSON).content(edit))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exercises[0].sets.length()").value(2))
                .andExpect(jsonPath("$.exercises[0].sets[0].weight").value("45"));
        mvc.perform(put("/api/workouts/" + wid).header("Authorization", bearer(b))
                .contentType(MediaType.APPLICATION_JSON).content(edit)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/workouts/" + wid).header("Authorization", bearer(b))).andExpect(status().isNotFound());
        mvc.perform(delete("/api/workouts/" + wid).header("Authorization", bearer(a))).andExpect(status().isNoContent());
        mvc.perform(get("/api/workouts/" + wid).header("Authorization", bearer(a))).andExpect(status().isNotFound());
    }

    @Test
    void equipmentPatchFlipsBodyweight() throws Exception {
        String t = register("eq@example.com");
        String ex = createExercise(t, "Thing", false);
        mvc.perform(patch("/api/exercises/" + ex).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"equipment\":\"KETTLEBELL\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.equipment").value("KETTLEBELL"))
                .andExpect(jsonPath("$.isBodyweight").value(false));
        mvc.perform(patch("/api/exercises/" + ex).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"equipment\":\"BODYWEIGHT\"}"))
                .andExpect(jsonPath("$.isBodyweight").value(true));
    }

    @Test
    void cardioSetRoundTrips() throws Exception {
        String t = register("cardio@example.com");
        String ex = id(mvc.perform(post("/api/exercises").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Run\",\"isBodyweight\":false,\"category\":\"CARDIO\"}"))
                .andReturn().getResponse().getContentAsString());
        String body = "{\"startedAt\":\"2026-06-04T07:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"Run\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"kind\":\"CARDIO\","
                + "\"distanceM\":\"5200\",\"durationS\":1574,\"gradePct\":\"1.0\",\"elevationGainM\":\"52.5\",\"cadenceSpm\":168}]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.exercises[0].sets[0].kind").value("CARDIO"))
                .andExpect(jsonPath("$.exercises[0].sets[0].distanceM").value("5200"))
                .andExpect(jsonPath("$.exercises[0].sets[0].durationS").value(1574))
                .andExpect(jsonPath("$.exercises[0].sets[0].elevationGainM").value("52.5"))   // all 5 cardio fields round-trip as strings/ints
                .andExpect(jsonPath("$.exercises[0].sets[0].cadenceSpm").value(168));
    }

    // A seeded CARDIO exercise carries its per-modality cardioMetrics (not the client's default fallback).
    // Rowing Machine → CADENCE, which is NOT in DEFAULT_CARDIO_METRICS [DISTANCE,DURATION,PACE] — so this
    // proves the seed's cardioMetrics actually round-trip through registration → the exercise API.
    @Test
    void seededCardioExerciseCarriesPerModalityMetrics() throws Exception {
        String t = register("cardioseed@example.com");
        JsonNode list = json.readTree(mvc.perform(get("/api/exercises").header("Authorization", bearer(t)))
                .andReturn().getResponse().getContentAsString());
        JsonNode rowing = null;
        for (JsonNode e : list) if ("Rowing Machine".equals(e.get("name").asText())) rowing = e;
        assertThat(rowing).as("Rowing Machine is seeded").isNotNull();
        List<String> metrics = new ArrayList<>();
        if (rowing.get("cardioMetrics") != null) rowing.get("cardioMetrics").forEach(m -> metrics.add(m.asText()));
        assertThat(metrics).as("per-modality seed, not the [DISTANCE,DURATION,PACE] fallback").contains("CADENCE");
    }

    // ── cardio validation (audit: CreateSetRequest cardio fields had NO Bean-Validation; council decision) ──
    private String cardioExercise(String t) throws Exception {
        return id(mvc.perform(post("/api/exercises").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Run\",\"isBodyweight\":false,\"category\":\"CARDIO\"}"))
                .andReturn().getResponse().getContentAsString());
    }
    // Unique startedAt per call — the workouts {userId, startedAt} unique index 409s a same-user repeat.
    private int cardioSeq = 0;
    private String cardioStart() { int n = cardioSeq++; return String.format("2026-06-04T07:%02d:%02dZ", n / 60, n % 60); }
    /** Post a workout with one cardio set built from the given field fragment; return the HTTP status. */
    private int postCardioSet(String t, String exId, String setFields) throws Exception {
        String body = "{\"startedAt\":\"" + cardioStart() + "\",\"exercises\":[{\"exerciseId\":\"" + exId
                + "\",\"name\":\"Run\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"kind\":\"CARDIO\","
                + setFields + "}]}]}";
        return mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getStatus();
    }

    // THE key guard: distanceM is METERS, so a 10 km run "10000" exceeds the ≤9999 strength DECIMAL_PATTERN.
    // The new CARDIO_DISTANCE_PATTERN must ACCEPT it (a reused DECIMAL_PATTERN would 400 a real 10 km run).
    @Test
    void cardioSetAcceptsTenKmRun() throws Exception {
        String t = register("cardio10k@example.com");
        String ex = cardioExercise(t);
        assertThat(postCardioSet(t, ex, "\"distanceM\":\"10000\",\"durationS\":2400")).isEqualTo(201);
        // and it round-trips the exact string, unrounded
        String created = mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON).content("{\"startedAt\":\"" + cardioStart() + "\",\"exercises\":[{\"exerciseId\":\""
                        + ex + "\",\"name\":\"Run\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"kind\":\"CARDIO\",\"distanceM\":\"10000\"}]}]}"))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(created).get("exercises").get(0).get("sets").get(0).get("distanceM").asText()).isEqualTo("10000");
    }

    @Test
    void cardioBoundaryValuesAccepted() throws Exception {
        String t = register("cardiobound@example.com");
        String ex = cardioExercise(t);
        assertThat(postCardioSet(t, ex, "\"distanceM\":\"999999.999\"")).as("~1000 km").isEqualTo(201);
        assertThat(postCardioSet(t, ex, "\"durationS\":86400")).as("24 h").isEqualTo(201);
        assertThat(postCardioSet(t, ex, "\"gradePct\":\"-30\"")).as("min grade").isEqualTo(201);
        assertThat(postCardioSet(t, ex, "\"gradePct\":\"40\"")).as("max grade").isEqualTo(201);
        assertThat(postCardioSet(t, ex, "\"elevationGainM\":\"20000\"")).as("max elevation").isEqualTo(201);
        assertThat(postCardioSet(t, ex, "\"cadenceSpm\":0")).isEqualTo(201);
        assertThat(postCardioSet(t, ex, "\"cadenceSpm\":300")).as("spin double-count ceiling").isEqualTo(201);
    }

    @Test
    void cardioValidationRejectsOutOfRange() throws Exception {
        String t = register("cardiobad@example.com");
        String ex = cardioExercise(t);
        assertThat(postCardioSet(t, ex, "\"distanceM\":\"-500\"")).as("negative distance").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"distanceM\":\"abc\"")).as("garbage distance").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"durationS\":86401")).as("over 24 h").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"durationS\":-1")).isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"gradePct\":\"abc\"")).as("garbage grade").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"gradePct\":\"55\"")).as("grade over +40").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"gradePct\":\"-45\"")).as("grade under -30").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"elevationGainM\":\"-10\"")).as("negative elevation").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"elevationGainM\":\"20001\"")).as("elevation over 20000").isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"cadenceSpm\":-1")).isEqualTo(400);
        assertThat(postCardioSet(t, ex, "\"cadenceSpm\":301")).as("cadence over 300").isEqualTo(400);
    }

    // A signed grade must be accepted and round-trip WITH its sign (dec() must not strip the minus).
    @Test
    void cardioSetAcceptsNegativeGrade() throws Exception {
        String t = register("cardiograde@example.com");
        String ex = cardioExercise(t);
        String created = mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON).content("{\"startedAt\":\"2026-06-04T07:00:00Z\",\"exercises\":[{\"exerciseId\":\""
                        + ex + "\",\"name\":\"Run\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"kind\":\"CARDIO\",\"gradePct\":\"-15.5\"}]}]}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(created).get("exercises").get(0).get("sets").get(0).get("gradePct").asText()).isEqualTo("-15.5");
    }

    // The full-replace PUT edit path must accept a re-saved cardio set (guards against a bound rejecting
    // already-stored data — a POST-only test can't catch a too-tight constraint on the edit round-trip).
    @Test
    void cardioEditPutRoundTrips() throws Exception {
        String t = register("cardioedit@example.com");
        String ex = cardioExercise(t);
        String wid = id(mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                .contentType(MediaType.APPLICATION_JSON).content("{\"startedAt\":\"2026-06-04T07:00:00Z\",\"exercises\":[{\"exerciseId\":\""
                        + ex + "\",\"name\":\"Run\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"kind\":\"CARDIO\",\"distanceM\":\"8000\",\"durationS\":2100}]}]}"))
                .andReturn().getResponse().getContentAsString());
        mvc.perform(put("/api/workouts/" + wid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"startedAt\":\"2026-06-04T07:00:00Z\",\"exercises\":[{\"exerciseId\":\""
                        + ex + "\",\"name\":\"Run\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"kind\":\"CARDIO\",\"distanceM\":\"8000\",\"durationS\":2100}]}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exercises[0].sets[0].distanceM").value("8000"));
    }

    @Test
    void profilePartialUpdateMergesFields() throws Exception {
        String t = register("prof@example.com");
        mvc.perform(put("/api/me/profile").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"sex\":\"MALE\",\"heightCm\":\"180\"}"))
                .andExpect(jsonPath("$.profile.sex").value("MALE"))
                .andExpect(jsonPath("$.profile.heightCm").value("180"));
        mvc.perform(put("/api/me/profile").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"goal\":\"GAIN_MUSCLE\"}"))
                .andExpect(jsonPath("$.profile.sex").value("MALE"))            // preserved across partial update
                .andExpect(jsonPath("$.profile.goal").value("GAIN_MUSCLE"));
    }

    @Test
    void backdatedWeighInKeepsLatestAsCurrent() throws Exception {
        String t = register("bw@example.com");
        mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"70.0\"}"))
                .andExpect(jsonPath("$.currentBodyweightKg").value("70.0"));
        mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"60.0\",\"recordedAt\":\"2020-01-01\"}"))
                .andExpect(jsonPath("$.currentBodyweightKg").value("70.0"))    // backdated old weight doesn't change current
                .andExpect(jsonPath("$.bodyweightLog.length()").value(2));
    }

    @Test
    void weighInsCanBeAmendedAndDeleted() throws Exception {
        String t = register("weighedit@example.com");
        String me = mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"80.0\",\"recordedAt\":\"2026-01-01\"}"))
                .andExpect(jsonPath("$.currentBodyweightKg").value("80.0")).andReturn().getResponse().getContentAsString();
        String id = json.readTree(me).get("bodyweightLog").get(0).get("id").asText();

        mvc.perform(patch("/api/me/bodyweight/" + id).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"81.5\"}"))
                .andExpect(jsonPath("$.currentBodyweightKg").value("81.5"));            // amend
        mvc.perform(delete("/api/me/bodyweight/" + id).header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.bodyweightLog.length()").value(0));              // delete
        mvc.perform(delete("/api/me/bodyweight/" + id).header("Authorization", bearer(t)))
                .andExpect(status().isNotFound());                                      // already gone
    }

    @Test
    void exerciseAttributesAreEditableAndCompoundNeedsTwoMuscles() throws Exception {
        String t = register("exedit@example.com");
        String ex = createExercise(t, "My Custom Press", false);
        mvc.perform(patch("/api/exercises/" + ex).header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"laterality\":\"UNILATERAL\",\"loadable\":false,\"equipment\":\"DUMBBELL\"}"))
                .andExpect(jsonPath("$.laterality").value("UNILATERAL"))
                .andExpect(jsonPath("$.loadable").value(false))
                .andExpect(jsonPath("$.equipment").value("DUMBBELL"));
        mvc.perform(patch("/api/exercises/" + ex).header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mechanic\":\"COMPOUND\",\"muscleContributions\":[{\"muscle\":\"CHEST\",\"fraction\":\"1.0\"}]}"))
                .andExpect(status().isBadRequest());                                    // compound needs >1 muscle
        mvc.perform(patch("/api/exercises/" + ex).header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mechanic\":\"COMPOUND\",\"muscleContributions\":[{\"muscle\":\"CHEST\",\"fraction\":\"1.0\"},{\"muscle\":\"TRICEP\",\"fraction\":\"0.5\"}]}"))
                .andExpect(jsonPath("$.mechanic").value("COMPOUND"));
    }

    @Test
    void exerciseMuscleMapInferredFromNameAndPersists() throws Exception {
        String t = register("mm@example.com");
        String ex = createExercise(t, "Brand New Lat Pulldown", false);   // not in the seed catalog
        mvc.perform(get("/api/exercises/" + ex + "/last-working-set").header("Authorization", bearer(t)))
                .andExpect(status().isNotFound());                          // no history yet (just a sanity call)
        mvc.perform(patch("/api/exercises/" + ex).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"muscleContributions\":[{\"muscle\":\"LAT\",\"fraction\":\"1.0\"}]}"))
                .andExpect(jsonPath("$.muscleContributions.length()").value(1))
                .andExpect(jsonPath("$.muscleContributions[0].muscle").value("LAT"));
    }

    @Test
    void newUserGetsTheSeededDefaultCatalog() throws Exception {
        String t = register("seed@example.com");
        String body = mvc.perform(get("/api/exercises").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.length()").value(org.hamcrest.Matchers.greaterThanOrEqualTo(80)))
                .andReturn().getResponse().getContentAsString();
        var arr = json.readTree(body);
        boolean bench = false, pullup = false;
        for (var e : arr) {
            if ("Barbell Bench Press".equals(e.get("name").asText())) {
                bench = true;
                assertThat(e.get("laterality").asText()).isEqualTo("BILATERAL");
                assertThat(e.get("mechanic").asText()).isEqualTo("COMPOUND");
                assertThat(e.get("isBodyweight").asBoolean()).isFalse();
                assertThat(e.get("muscleContributions").toString()).contains("CHEST");
            }
            if ("Pull Up".equals(e.get("name").asText())) {
                pullup = true;
                assertThat(e.get("isBodyweight").asBoolean()).isTrue();
                assertThat(e.get("loadable").asBoolean()).isTrue();      // weighted / assisted possible
            }
        }
        assertThat(bench).isTrue();
        assertThat(pullup).isTrue();
    }

    @Test
    void restoreDefaultsAddsMissingAndIsIdempotent() throws Exception {
        String t = register("restore@example.com");                       // seeded with the full catalog
        mongo.getDb().getCollection("exercises").deleteOne(new org.bson.Document("name", "Plank"));   // user now missing one
        mvc.perform(post("/api/exercises/restore-defaults").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.added").value(1));                  // re-adds the missing default
        mvc.perform(post("/api/exercises/restore-defaults").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.added").value(0));                  // nothing left to add — no duplicates
    }

    @Test
    void workoutCyclePhaseRoundTrips() throws Exception {
        String t = register("cp@example.com");
        String ex = createExercise(t, "Squat", false);
        String body = "{\"startedAt\":\"2026-06-05T10:00:00Z\",\"cyclePhase\":\"DELOAD\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"x\",\"position\":0,\"sets\":[{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"40\",\"reps\":8}]}]}";
        String wid = id(mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cyclePhase").value("DELOAD")).andReturn().getResponse().getContentAsString());
        mvc.perform(get("/api/workouts/" + wid).header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.cyclePhase").value("DELOAD"));
    }

    @Test
    void planLifecycleAndIsolation() throws Exception {
        String a = register("plana@example.com");
        String b = register("planb@example.com");
        mvc.perform(get("/api/plan").header("Authorization", bearer(a))).andExpect(status().isNoContent());

        mvc.perform(post("/api/plan").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Block\",\"mesocycles\":[{\"name\":\"M1\",\"accumulationWeeks\":2,\"phase\":\"SURPLUS\",\"focusMuscles\":[\"CHEST\"]}]}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.week").value(1));
        mvc.perform(post("/api/plan/advance").header("Authorization", bearer(a))).andExpect(jsonPath("$.week").value(2));
        mvc.perform(post("/api/plan/advance").header("Authorization", bearer(a))).andExpect(jsonPath("$.week").value(3)); // deload week
        mvc.perform(post("/api/plan/advance").header("Authorization", bearer(a))).andExpect(jsonPath("$.status").value("COMPLETED"));

        mvc.perform(get("/api/plan").header("Authorization", bearer(b))).andExpect(status().isNoContent());     // isolation
        mvc.perform(post("/api/plan/advance").header("Authorization", bearer(b))).andExpect(status().isNotFound());
        mvc.perform(get("/api/plan").header("Authorization", bearer(a))).andExpect(status().isNoContent());     // completed ≠ active
    }

    // ── plan state-machine (council SM1–SM7) ──
    private org.springframework.test.web.servlet.ResultActions adv(String t) throws Exception {
        return mvc.perform(post("/api/plan/advance").header("Authorization", bearer(t)));
    }
    private String planBody(String name) {
        return "{\"name\":\"" + name + "\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":2,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}";
    }

    // SM1 — advance walks week 1..accum then one deload week, rolls to the NEXT meso at week 1, and COMPLETES
    // only after the last block's deload (the multi-mesocycle transition the single-block test never exercises).
    @Test
    void advanceWalksThroughMultipleMesocycles() throws Exception {
        String t = register("planmulti@example.com");
        String plan = "{\"name\":\"Multi\",\"mesocycles\":["
                + "{\"name\":\"M1\",\"accumulationWeeks\":2,\"phase\":\"SURPLUS\",\"focusMuscles\":[]},"
                + "{\"name\":\"M2\",\"accumulationWeeks\":1,\"phase\":\"MAINTENANCE\",\"focusMuscles\":[]}]}";
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(plan))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.mesoIndex").value(0)).andExpect(jsonPath("$.week").value(1));
        adv(t).andExpect(jsonPath("$.mesoIndex").value(0)).andExpect(jsonPath("$.week").value(2));
        adv(t).andExpect(jsonPath("$.mesoIndex").value(0)).andExpect(jsonPath("$.week").value(3));  // M1 deload week
        adv(t).andExpect(jsonPath("$.mesoIndex").value(1)).andExpect(jsonPath("$.week").value(1));  // rolled to M2
        adv(t).andExpect(jsonPath("$.mesoIndex").value(1)).andExpect(jsonPath("$.week").value(2));  // M2 deload week
        adv(t).andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    // SM3 — POST /api/plan replaces any ACTIVE plan: at most one ACTIVE per user, the prior is COMPLETED.
    @Test
    void creatingAPlanReplacesTheActiveOne() throws Exception {
        String t = register("planreplace@example.com");
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(planBody("P1"))).andExpect(status().isCreated());
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(planBody("P2"))).andExpect(status().isCreated());
        mvc.perform(get("/api/plan").header("Authorization", bearer(t))).andExpect(jsonPath("$.name").value("P2"));
        assertThat(mongo.getDb().getCollection("plans").countDocuments(new org.bson.Document("status", "ACTIVE"))).isEqualTo(1L);
    }

    // SM4 — every plan-mutating endpoint is tenant-scoped: user B can't append to / end / advance user A's plan.
    @Test
    void planMutationsAreTenantIsolated() throws Exception {
        String a = register("planiso-a@example.com");
        String b = register("planiso-b@example.com");
        mvc.perform(post("/api/plan").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON).content(planBody("A"))).andExpect(status().isCreated());
        String meso = "{\"name\":\"X\",\"accumulationWeeks\":1,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}";
        mvc.perform(post("/api/plan/mesocycle").header("Authorization", bearer(b)).contentType(MediaType.APPLICATION_JSON).content(meso)).andExpect(status().isNotFound());
        mvc.perform(delete("/api/plan").header("Authorization", bearer(b))).andExpect(status().isNoContent());   // ends B's (none), not A's
        mvc.perform(get("/api/plan").header("Authorization", bearer(a))).andExpect(status().isOk()).andExpect(jsonPath("$.name").value("A"));
    }

    // SM5 — intensityBand validation: pctLow ≤ pctHigh and targetRir must be a number/range (not a free string).
    @Test
    void intensityBandValidationRejectsBadBands() throws Exception {
        String t = register("planband@example.com");
        String swap = "{\"name\":\"P\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":4,\"phase\":\"SURPLUS\",\"focusMuscles\":[],"
                + "\"intensityBand\":{\"repLow\":8,\"repHigh\":12,\"targetRir\":\"2\",\"pctLow\":\"0.9\",\"pctHigh\":\"0.6\"}}]}";
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(swap)).andExpect(status().isBadRequest());
        String badRir = "{\"name\":\"P\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":4,\"phase\":\"SURPLUS\",\"focusMuscles\":[],"
                + "\"intensityBand\":{\"repLow\":8,\"repHigh\":12,\"targetRir\":\"banana\",\"pctLow\":null,\"pctHigh\":null}}]}";
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(badRir)).andExpect(status().isBadRequest());
        String ok = "{\"name\":\"P\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":4,\"phase\":\"SURPLUS\",\"focusMuscles\":[],"
                + "\"intensityBand\":{\"repLow\":8,\"repHigh\":12,\"targetRir\":\"1-2\",\"pctLow\":\"0.6\",\"pctHigh\":\"0.75\"}}]}";
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON).content(ok)).andExpect(status().isCreated());
    }

    // ── synced settings (local-first base + cloud sync) ──
    @Test
    void settingsRoundTripWithLastWriteWins() throws Exception {
        String t = register("settings@example.com");
        mvc.perform(get("/api/me/settings").header("Authorization", bearer(t)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.settings.coachEnabled").doesNotExist())   // empty for a new user
                .andExpect(jsonPath("$.updatedAt").value("0"));
        // write at ts=1000
        mvc.perform(put("/api/me/settings").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settings\":{\"coachEnabled\":\"false\",\"prevSource\":\"template\"},\"updatedAt\":\"1000\"}"))
                .andExpect(jsonPath("$.settings.coachEnabled").value("false")).andExpect(jsonPath("$.updatedAt").value("1000"));
        mvc.perform(get("/api/me/settings").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.settings.prevSource").value("template"));
        // a STALE write (older ts) must not clobber
        mvc.perform(put("/api/me/settings").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settings\":{\"coachEnabled\":\"true\"},\"updatedAt\":\"500\"}"))
                .andExpect(jsonPath("$.settings.coachEnabled").value("false")).andExpect(jsonPath("$.updatedAt").value("1000"));
        // a NEWER write wins
        mvc.perform(put("/api/me/settings").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settings\":{\"coachEnabled\":\"true\"},\"updatedAt\":\"2000\"}"))
                .andExpect(jsonPath("$.settings.coachEnabled").value("true")).andExpect(jsonPath("$.updatedAt").value("2000"));
    }

    @Test
    void settingsAreTenantIsolated() throws Exception {
        String a = register("seta@example.com");
        String b = register("setb@example.com");
        mvc.perform(put("/api/me/settings").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settings\":{\"prevSource\":\"template\"},\"updatedAt\":\"1000\"}")).andExpect(status().isOk());
        mvc.perform(get("/api/me/settings").header("Authorization", bearer(b)))
                .andExpect(jsonPath("$.settings.prevSource").doesNotExist())     // B never sees A's settings
                .andExpect(jsonPath("$.updatedAt").value("0"));
    }

    // SM8 — completing a plan via advance stamps completedAt; it appears in /plan/history but not /plan.
    @Test
    void completedPlanAppearsInHistoryWithTimestamp() throws Exception {
        String t = register("hist-complete@example.com");
        // Single mesocycle with 1 accumulation week → 2 advances to complete (week2 = deload, week3 = COMPLETED).
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"HistPlan\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":1,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}"))
                .andExpect(status().isCreated());
        adv(t).andExpect(jsonPath("$.week").value(2));         // deload week
        adv(t).andExpect(jsonPath("$.status").value("COMPLETED"))
              .andExpect(jsonPath("$.completedAt").isNotEmpty());   // completedAt stamped

        // Active plan is gone.
        mvc.perform(get("/api/plan").header("Authorization", bearer(t))).andExpect(status().isNoContent());

        // History returns the completed plan.
        mvc.perform(get("/api/plan/history").header("Authorization", bearer(t)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("COMPLETED"))
                .andExpect(jsonPath("$[0].completedAt").isNotEmpty())
                .andExpect(jsonPath("$[0].endedAt").doesNotExist());
    }

    // SM9 — DELETE /plan stamps endedAt and surfaces as ENDED in /plan/history.
    @Test
    void endedPlanAppearsInHistoryWithEndedAt() throws Exception {
        String t = register("hist-end@example.com");
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"AbandonPlan\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":2,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}"))
                .andExpect(status().isCreated());
        mvc.perform(delete("/api/plan").header("Authorization", bearer(t))).andExpect(status().isNoContent());

        mvc.perform(get("/api/plan").header("Authorization", bearer(t))).andExpect(status().isNoContent());

        mvc.perform(get("/api/plan/history").header("Authorization", bearer(t)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("ENDED"))
                .andExpect(jsonPath("$[0].endedAt").isNotEmpty())
                .andExpect(jsonPath("$[0].completedAt").doesNotExist());
    }

    // SM10 — /plan/history is tenant-isolated: user B's history never contains user A's terminal plans.
    @Test
    void planHistoryIsTenantIsolated() throws Exception {
        String a = register("hista@example.com");
        String b = register("histb@example.com");

        // A completes a plan.
        mvc.perform(post("/api/plan").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"APlan\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":1,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}"))
                .andExpect(status().isCreated());
        adv(a); adv(a);   // deload then complete

        // A also ends a second plan early.
        mvc.perform(post("/api/plan").header("Authorization", bearer(a)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"APlan2\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":2,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}"))
                .andExpect(status().isCreated());
        mvc.perform(delete("/api/plan").header("Authorization", bearer(a))).andExpect(status().isNoContent());

        // A sees both entries in history.
        mvc.perform(get("/api/plan/history").header("Authorization", bearer(a)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        // B sees nothing — strict tenant isolation.
        mvc.perform(get("/api/plan/history").header("Authorization", bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // SM7 — addMesocycle appends to the live plan and the appended block is reachable by the cursor (advance
    // rolls INTO it instead of completing).
    @Test
    void addMesocycleAppendsAndIsReachable() throws Exception {
        String t = register("planappend@example.com");
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"P\",\"mesocycles\":[{\"name\":\"M1\",\"accumulationWeeks\":1,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}"))
                .andExpect(status().isCreated());
        mvc.perform(post("/api/plan/mesocycle").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"M2\",\"accumulationWeeks\":1,\"phase\":\"MAINTENANCE\",\"focusMuscles\":[]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mesocycles.length()").value(2));
        adv(t).andExpect(jsonPath("$.week").value(2));                                                  // M1 deload week
        adv(t).andExpect(jsonPath("$.mesoIndex").value(1)).andExpect(jsonPath("$.status").value("ACTIVE"));  // rolled into the appended M2
    }

    // ── CreateSetRequest input validation (mirrors UpdateSetRequest bounds) ──

    @Test
    void createWorkoutValidationRejectsBogusRepsAndRpe() throws Exception {
        String t = register("validate@example.com");
        String ex = createExercise(t, "Validate Press", false);

        // reps=99999 is above @Max(1000) — must be rejected with 400
        String badReps = "{\"startedAt\":\"2026-06-10T10:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"Validate Press\",\"position\":0,\"sets\":["
                + "{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"100\",\"reps\":99999}]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(badReps))
                .andExpect(status().isBadRequest());

        // rpe=50 is above @Max(10) — must be rejected with 400
        String badRpe = "{\"startedAt\":\"2026-06-10T10:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"Validate Press\",\"position\":0,\"sets\":["
                + "{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"100\",\"reps\":5,\"rpe\":50}]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(badRpe))
                .andExpect(status().isBadRequest());

        // valid workout still saves (200/201)
        String valid = "{\"startedAt\":\"2026-06-10T10:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"Validate Press\",\"position\":0,\"sets\":["
                + "{\"orderIndex\":0,\"setType\":\"WORKING\",\"weight\":\"100\",\"reps\":5,\"rpe\":8}]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(valid))
                .andExpect(status().isCreated());
    }

    // ── Split weekdays persistence ──

    // Split created with weekdays=[0,2,4] round-trips correctly via GET /api/splits.
    @Test
    void splitWithWeekdaysRoundTrips() throws Exception {
        String t = register("weekdays@example.com");
        String ex = createExercise(t, "Press", false);
        String t1 = createTemplate(t, "Day1", ex);
        String t2 = createTemplate(t, "Day2", ex);
        String t3 = createTemplate(t, "Day3", ex);
        String sid = id(mvc.perform(post("/api/splits").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"MWF\",\"templateIds\":[\"" + t1 + "\",\"" + t2 + "\",\"" + t3 + "\"],\"weekdays\":[0,2,4]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.weekdays.length()").value(3))
                .andExpect(jsonPath("$.weekdays[0]").value(0))
                .andExpect(jsonPath("$.weekdays[1]").value(2))
                .andExpect(jsonPath("$.weekdays[2]").value(4))
                .andReturn().getResponse().getContentAsString());
        // Verify via GET list
        mvc.perform(get("/api/splits").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].weekdays.length()").value(3))
                .andExpect(jsonPath("$[0].weekdays[1]").value(2));
        // Update and re-check
        mvc.perform(put("/api/splits/" + sid).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"MWF\",\"templateIds\":[\"" + t1 + "\",\"" + t2 + "\",\"" + t3 + "\"],\"weekdays\":[1,3,5]}"))
                .andExpect(jsonPath("$.weekdays[0]").value(1))
                .andExpect(jsonPath("$.weekdays[2]").value(5));
    }

    // Split created without weekdays (null) round-trips as null — back-compat for old docs.
    @Test
    void splitWithoutWeekdaysRoundTripsAsNull() throws Exception {
        String t = register("noweekdays@example.com");
        String ex = createExercise(t, "Row", false);
        String t1 = createTemplate(t, "Pull", ex);
        mvc.perform(post("/api/splits").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Legacy\",\"templateIds\":[\"" + t1 + "\"]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.weekdays").doesNotExist());
        mvc.perform(get("/api/splits").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$[0].weekdays").doesNotExist());
    }

    // Plan created with a splitId round-trips via GET /api/plan and /api/plan/history.
    @Test
    void planWithSplitIdRoundTrips() throws Exception {
        String t = register("plansplit@example.com");
        String ex = createExercise(t, "Squat X", false);
        String tmpl = createTemplate(t, "Legs", ex);
        String sid = id(mvc.perform(post("/api/splits").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"WkSplit\",\"templateIds\":[\"" + tmpl + "\"],\"weekdays\":[0]}"))
                .andReturn().getResponse().getContentAsString());

        // Create plan referencing the split
        mvc.perform(post("/api/plan").header("Authorization", bearer(t)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"ScheduledPlan\",\"splitId\":\"" + sid + "\","
                                + "\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":1,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.splitId").value(sid));

        // GET active plan returns splitId
        mvc.perform(get("/api/plan").header("Authorization", bearer(t)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.splitId").value(sid));

        // Complete plan and verify splitId appears in history
        adv(t);  // deload week
        adv(t);  // COMPLETED
        mvc.perform(get("/api/plan/history").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$[0].splitId").value(sid));
    }

    // ── concurrency invariants (prod-readiness audit 2026-06-30) ──
    // Fire `n` identical actions simultaneously (released by a single latch for maximum contention) and
    // return each one's HTTP status. Drives the register / createPlan races below.
    private List<Integer> fireConcurrently(int n, Callable<Integer> action) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        try {
            CountDownLatch ready = new CountDownLatch(n);
            CountDownLatch go = new CountDownLatch(1);
            List<Future<Integer>> futures = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    go.await();          // all threads block here, then fire together
                    return action.call();
                }));
            }
            ready.await();
            go.countDown();
            List<Integer> codes = new ArrayList<>();
            for (Future<Integer> f : futures) codes.add(f.get());
            return codes;
        } finally {
            pool.shutdown();
            pool.awaitTermination(30, TimeUnit.SECONDS);
        }
    }

    // C1 — the register TOCTOU (existsByEmail then save) must not create duplicate accounts under
    // concurrency. The DB-level unique users.email index is the real guard; the friendly pre-check isn't
    // enough. A duplicate would also permanently break login (findByEmail → IncorrectResultSize → 500).
    @Test
    void concurrentRegisterOfSameEmailCreatesExactlyOneAccount() throws Exception {
        String body = "{\"email\":\"race@example.com\",\"password\":\"password123\"}";
        List<Integer> codes = fireConcurrently(12, () ->
                mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON).content(body))
                        .andReturn().getResponse().getStatus());

        long accounts = mongo.getDb().getCollection("users")
                .countDocuments(new org.bson.Document("email", "race@example.com"));
        long created = codes.stream().filter(c -> c == 201).count();
        assertThat(accounts).as("exactly one account persisted for the email").isEqualTo(1L);
        assertThat(created).as("exactly one register returned 201").isEqualTo(1L);
        assertThat(codes).as("race losers get 409, never 500").allMatch(c -> c == 201 || c == 409);

        // The survivor can still log in — i.e. no duplicate split findByEmail into an IncorrectResultSize 500.
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk());
    }

    // H1 — "exactly one ACTIVE macrocycle per user" must survive concurrent createPlan. create() does a
    // non-atomic updateMulti(ACTIVE→ENDED)+insert; only a partial-unique index {userId} where status=ACTIVE
    // keeps two simultaneous inserts from both landing ACTIVE.
    @Test
    void concurrentCreatePlanLeavesExactlyOneActivePlan() throws Exception {
        String t = register("planrace@example.com");
        List<Integer> codes = fireConcurrently(10, () ->
                mvc.perform(post("/api/plan").header("Authorization", bearer(t))
                                .contentType(MediaType.APPLICATION_JSON).content(planBody("P")))
                        .andReturn().getResponse().getStatus());

        long active = mongo.getDb().getCollection("plans")
                .countDocuments(new org.bson.Document("status", "ACTIVE"));
        assertThat(active).as("at most one ACTIVE plan after concurrent creates").isEqualTo(1L);
        assertThat(codes).as("losers get 409, never 500").allMatch(c -> c == 201 || c == 409);
        assertThat(codes).as("at least one create succeeded").contains(201);
    }

    // Tenant isolation still holds for splits with weekdays: user B never sees user A's split.
    @Test
    void splitWeekdaysAreTenantIsolated() throws Exception {
        String a = register("wda@example.com");
        String b = register("wdb@example.com");
        String ex = createExercise(a, "PressX", false);
        String t1 = createTemplate(a, "T", ex);
        mvc.perform(post("/api/splits").header("Authorization", bearer(a))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"ASplit\",\"templateIds\":[\"" + t1 + "\"],\"weekdays\":[0,2]}"))
                .andExpect(status().isCreated());
        // B sees an empty split list
        mvc.perform(get("/api/splits").header("Authorization", bearer(b)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ── backend-hardening cluster (prod audit) ──

    // H2 — advance() must not lose updates under concurrency. Without an optimistic lock on Macrocycle, N
    // simultaneous advances all read the same week and all save week+1 (a lost update: 10×200 but week only
    // +1). With @Version the losers get a 409 conflict and committed advances exactly equal the week delta.
    @Test
    void concurrentAdvanceDoesNotLoseUpdates() throws Exception {
        String t = register("advancerace@example.com");
        // accumulationWeeks=50 ⇒ every advance is a pure week increment (no deload roll / meso transition).
        String plan = "{\"name\":\"Long\",\"mesocycles\":[{\"name\":\"M\",\"accumulationWeeks\":50,\"phase\":\"SURPLUS\",\"focusMuscles\":[]}]}";
        mvc.perform(post("/api/plan").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(plan))
                .andExpect(status().isCreated());

        List<Integer> codes = fireConcurrently(10, () ->
                mvc.perform(post("/api/plan/advance").header("Authorization", bearer(t)))
                        .andReturn().getResponse().getStatus());

        int week = json.readTree(mvc.perform(get("/api/plan").header("Authorization", bearer(t)))
                .andReturn().getResponse().getContentAsString()).get("week").asInt();
        long committed = codes.stream().filter(c -> c == 200).count();
        assertThat(week - 1).as("no lost update: committed advances equal the week delta").isEqualTo((int) committed);
        assertThat(codes).as("every non-200 is a 409 conflict, never 500").allMatch(c -> c == 200 || c == 409);
        assertThat(codes).as("at least one advance committed").contains(200);
    }

    // M1 — bodyweight weightKg is bounded to ≤3 decimal places at the source (matches the client's 3-dp
    // rounding), so a finer value can't be stored / poison the effective-load calc.
    @Test
    void bodyweightRejectsMoreThanThreeDecimals() throws Exception {
        String t = register("bwprec@example.com");
        mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"72.3456\"}"))
                .andExpect(status().isBadRequest());                                    // 4 dp rejected
        mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"72.345\"}"))
                .andExpect(status().isOk());                                            // 3 dp accepted
    }

    // M2 — a malformed JSON body is the client's fault → 400, not the opaque 500 the generic handler gives.
    @Test
    void malformedJsonBodyReturns400() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest());
    }

    // M2 — an unparseable date reaching a bare LocalDate.parse path is 400, not 500.
    @Test
    void invalidDateInBodyweightReturns400() throws Exception {
        String t = register("baddate@example.com");
        mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"weightKg\":\"70\",\"recordedAt\":\"not-a-date\"}"))
                .andExpect(status().isBadRequest());
    }

    // M4 — a block with more than 100 sets is rejected (@Size) before it can be persisted.
    @Test
    void blockWithTooManySetsReturns400() throws Exception {
        String t = register("toomanysets@example.com");
        String ex = createExercise(t, "PressY", false);
        StringBuilder sets = new StringBuilder();
        for (int i = 0; i < 101; i++) {
            if (i > 0) sets.append(",");
            sets.append("{\"orderIndex\":").append(i).append(",\"setType\":\"WORKING\",\"weight\":\"50\",\"reps\":5}");
        }
        String body = "{\"startedAt\":\"2026-06-03T09:00:00Z\",\"exercises\":[{\"exerciseId\":\"" + ex
                + "\",\"name\":\"x\",\"position\":0,\"sets\":[" + sets + "]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest());
    }

    // M5 — split weekdays are constrained to 0..6 (element constraint); an out-of-range day is rejected.
    @Test
    void splitWeekdaysOutOfRangeRejected() throws Exception {
        String t = register("weekdayrange@example.com");
        String ex = createExercise(t, "PressZ", false);
        String t1 = createTemplate(t, "T", ex);
        mvc.perform(post("/api/splits").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"S\",\"templateIds\":[\"" + t1 + "\"],\"weekdays\":[0,9]}"))
                .andExpect(status().isBadRequest());                                    // 9 out of range
        mvc.perform(post("/api/splits").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"S\",\"templateIds\":[\"" + t1 + "\"],\"weekdays\":[0,6]}"))
                .andExpect(status().isCreated());                                       // boundary 6 ok
    }

    // ── M3: User-doc concurrency (audit M3, council docs — targeted atomic ops, no @Version) ──
    // Council contract: every MeController write is a targeted atomic update keyed {_id: tenant.userId()};
    // settings LWW is one conditional updateFirst (always 200, superseded write returns the persisted
    // winner, NEVER 409 — the client swallows settings errors); currentBodyweightKg is DERIVED at read
    // (latest non-estimated), never a stored mirror; GETs never write (backfill moves to a startup runner).

    private String meId(String t) throws Exception {
        return json.readTree(mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andReturn().getResponse().getContentAsString()).get("id").asText();
    }
    private org.bson.Document rawUser(String id) {
        return mongo.getDb().getCollection("users")
                .find(new org.bson.Document("_id", new org.bson.types.ObjectId(id))).first();
    }
    private int settingsStatus(String t, long ts, String v) throws Exception {
        return mvc.perform(put("/api/me/settings").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settings\":{\"k\":\"" + v + "\"},\"updatedAt\":\"" + ts + "\"}"))
                .andReturn().getResponse().getStatus();
    }
    private int addBwStatus(String t, String w) throws Exception {
        return mvc.perform(put("/api/me/bodyweight").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"" + w + "\"}"))
                .andReturn().getResponse().getStatus();
    }

    // M3 core (RED pre-fix): a settings PUT built from a snapshot that predates a parallel weigh-in must
    // not drop the weigh-in on save. Alternate the two writes across concurrent threads; both must survive.
    @Test
    void concurrentSettingsAndBodyweightWritesBothSurvive() throws Exception {
        String t = register("m3core@example.com");
        java.util.concurrent.atomic.AtomicInteger i = new java.util.concurrent.atomic.AtomicInteger();
        List<Integer> codes = fireConcurrently(6, () -> (i.getAndIncrement() % 2 == 0)
                ? settingsStatus(t, 1000, "vs")
                : addBwStatus(t, "81.5"));
        assertThat(codes).allMatch(c -> c == 200);
        String me = mvc.perform(get("/api/me").header("Authorization", bearer(t))).andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(me).get("bodyweightLog").size()).as("no weigh-in lost to a settings save").isEqualTo(3);
        mvc.perform(get("/api/me/settings").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.settings.k").value("vs"));
    }

    // Settings LWW under concurrency: distinct timestamps race; all 200, the highest timestamp wins, never torn.
    @Test
    void concurrentSettingsPutsKeepLastWriteWins() throws Exception {
        String t = register("lwwrace@example.com");
        java.util.concurrent.atomic.AtomicInteger i = new java.util.concurrent.atomic.AtomicInteger();
        List<Integer> codes = fireConcurrently(8, () -> {
            int k = i.getAndIncrement();
            return settingsStatus(t, 1000 + k, "v" + k);
        });
        assertThat(codes).as("LWW never errors — no 409/500 on the settings path").allMatch(c -> c == 200);
        mvc.perform(get("/api/me/settings").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.settings.k").value("v7"))
                .andExpect(jsonPath("$.updatedAt").value("1007"));
    }

    // Superseded-write contract: a stale PUT returns 200 with the PERSISTED winner, not the caller's payload.
    @Test
    void supersededSettingsWriteReturnsPersistedWinner() throws Exception {
        String t = register("superseded@example.com");
        assertThat(settingsStatus(t, 2000, "newer")).isEqualTo(200);
        mvc.perform(put("/api/me/settings").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"settings\":{\"k\":\"stale\"},\"updatedAt\":\"1000\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.settings.k").value("newer"))
                .andExpect(jsonPath("$.updatedAt").value("2000"));
    }

    // Concurrent appends (RED pre-fix): full-doc saves lose parallel appends; $push must keep all N.
    @Test
    void concurrentBodyweightAddsAllSurvive() throws Exception {
        String t = register("bwrace@example.com");
        List<Integer> codes = fireConcurrently(10, () -> addBwStatus(t, "80.5"));
        assertThat(codes).allMatch(c -> c == 200);
        String me = mvc.perform(get("/api/me").header("Authorization", bearer(t))).andReturn().getResponse().getContentAsString();
        JsonNode log = json.readTree(me).get("bodyweightLog");
        assertThat(log.size()).as("every concurrent append survives").isEqualTo(10);
        long distinct = java.util.stream.StreamSupport.stream(log.spliterator(), false)
                .map(e -> e.get("id").asText()).distinct().count();
        assertThat(distinct).as("no duplicate entry ids").isEqualTo(10);
    }

    // Cap boundary under concurrency (RED pre-fix: TOCTOU lets every racer pass the size check).
    @Test
    void bodyweightCapHoldsUnderConcurrentAdds() throws Exception {
        String t = register("bwcap@example.com");
        String uid = meId(t);
        java.util.List<org.bson.Document> seed = new java.util.ArrayList<>();
        for (int k = 0; k < 3649; k++) {
            seed.add(new org.bson.Document("entryId", new org.bson.types.ObjectId().toHexString())
                    .append("recordedAt", java.util.Date.from(java.time.Instant.parse("2020-01-01T00:00:00Z").plusSeconds(k)))
                    .append("weightKg", org.bson.types.Decimal128.parse("80"))
                    .append("estimated", true));
        }
        mongo.getDb().getCollection("users").updateOne(
                new org.bson.Document("_id", new org.bson.types.ObjectId(uid)),
                new org.bson.Document("$set", new org.bson.Document("bodyweightLog", seed)));
        List<Integer> codes = fireConcurrently(5, () -> addBwStatus(t, "80.5"));
        assertThat(codes.stream().filter(c -> c == 200).count()).as("exactly one add wins the last slot").isEqualTo(1);
        assertThat(codes).as("losers get the cap 400, never 500").allMatch(c -> c == 200 || c == 400);
        org.bson.Document u = rawUser(uid);
        assertThat(((java.util.List<?>) u.get("bodyweightLog")).size()).as("log never exceeds the cap").isEqualTo(3650);
    }

    // Disjoint entry ops race (RED pre-fix): amend A + delete B concurrently; both must apply.
    @Test
    void disjointBodyweightEntryOpsBothApply() throws Exception {
        String t = register("bwdisjoint@example.com");
        assertThat(addBwStatus(t, "80")).isEqualTo(200);
        assertThat(addBwStatus(t, "81")).isEqualTo(200);
        String me = mvc.perform(get("/api/me").header("Authorization", bearer(t))).andReturn().getResponse().getContentAsString();
        JsonNode log = json.readTree(me).get("bodyweightLog");
        String idA = log.get(0).get("id").asText(), idB = log.get(1).get("id").asText();
        java.util.concurrent.atomic.AtomicInteger i = new java.util.concurrent.atomic.AtomicInteger();
        List<Integer> codes = fireConcurrently(2, () -> (i.getAndIncrement() == 0)
                ? mvc.perform(patch("/api/me/bodyweight/" + idA).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"85.5\"}"))
                        .andReturn().getResponse().getStatus()
                : mvc.perform(delete("/api/me/bodyweight/" + idB).header("Authorization", bearer(t)))
                        .andReturn().getResponse().getStatus());
        assertThat(codes).allMatch(c -> c == 200);
        String after = mvc.perform(get("/api/me").header("Authorization", bearer(t))).andReturn().getResponse().getContentAsString();
        JsonNode alog = json.readTree(after).get("bodyweightLog");
        assertThat(alog.size()).as("delete applied").isEqualTo(1);
        assertThat(alog.get(0).get("id").asText()).isEqualTo(idA);
        assertThat(alog.get(0).get("weightKg").asText()).as("amend applied").isEqualTo("85.5");
    }

    // Same-entry amend/delete race: exactly one outcome persists; never a 500, never a corrupt log.
    @Test
    void sameEntryAmendDeleteRaceIsSane() throws Exception {
        String t = register("bwsame@example.com");
        assertThat(addBwStatus(t, "80")).isEqualTo(200);
        String me = mvc.perform(get("/api/me").header("Authorization", bearer(t))).andReturn().getResponse().getContentAsString();
        String id = json.readTree(me).get("bodyweightLog").get(0).get("id").asText();
        java.util.concurrent.atomic.AtomicInteger i = new java.util.concurrent.atomic.AtomicInteger();
        List<Integer> codes = fireConcurrently(2, () -> (i.getAndIncrement() == 0)
                ? mvc.perform(patch("/api/me/bodyweight/" + id).header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"82\"}"))
                        .andReturn().getResponse().getStatus()
                : mvc.perform(delete("/api/me/bodyweight/" + id).header("Authorization", bearer(t)))
                        .andReturn().getResponse().getStatus());
        assertThat(codes).as("no 500 under a same-entry race").allMatch(c -> c == 200 || c == 404);
        JsonNode alog = json.readTree(mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andReturn().getResponse().getContentAsString()).get("bodyweightLog");
        assertThat(alog.size()).as("entry is amended XOR deleted").isIn(0, 1);
        if (alog.size() == 1) assertThat(alog.get(0).get("weightKg").asText()).isEqualTo("82");
    }

    // Missing-id guard: amend/delete of an unknown entry id → 404 with NO phantom updatedAt bump.
    @Test
    void missingEntryIdReturns404WithoutPhantomBump() throws Exception {
        String t = register("bwmissing@example.com");
        assertThat(addBwStatus(t, "80")).isEqualTo(200);
        Object before = rawUser(meId(t)).get("updatedAt");
        mvc.perform(patch("/api/me/bodyweight/deadbeef").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"90\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/me/bodyweight/deadbeef").header("Authorization", bearer(t)))
                .andExpect(status().isNotFound());
        assertThat(rawUser(meId(t)).get("updatedAt")).as("no write on a missed match").isEqualTo(before);
    }

    // Tenant isolation on the rewritten paths: B cannot touch A's entries and B's writes never reach A.
    @Test
    void bodyweightEntryOpsAreTenantIsolated() throws Exception {
        String a = register("bwta@example.com");
        String b = register("bwtb@example.com");
        assertThat(addBwStatus(a, "80")).isEqualTo(200);
        String idA = json.readTree(mvc.perform(get("/api/me").header("Authorization", bearer(a)))
                .andReturn().getResponse().getContentAsString()).get("bodyweightLog").get(0).get("id").asText();
        mvc.perform(patch("/api/me/bodyweight/" + idA).header("Authorization", bearer(b))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"1\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/me/bodyweight/" + idA).header("Authorization", bearer(b)))
                .andExpect(status().isNotFound());
        JsonNode aLog = json.readTree(mvc.perform(get("/api/me").header("Authorization", bearer(a)))
                .andReturn().getResponse().getContentAsString()).get("bodyweightLog");
        assertThat(aLog.get(0).get("weightKg").asText()).isEqualTo("80");
    }

    // Profile disjoint fields (RED pre-fix): concurrent single-field updates must both land.
    @Test
    void concurrentProfileDisjointFieldsBothLand() throws Exception {
        String t = register("profrace@example.com");
        java.util.concurrent.atomic.AtomicInteger i = new java.util.concurrent.atomic.AtomicInteger();
        List<Integer> codes = fireConcurrently(2, () -> (i.getAndIncrement() == 0)
                ? mvc.perform(put("/api/me/profile").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"heightCm\":\"180.5\"}"))
                        .andReturn().getResponse().getStatus()
                : mvc.perform(put("/api/me/profile").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"goal\":\"GAIN_MUSCLE\"}"))
                        .andReturn().getResponse().getStatus());
        assertThat(codes).allMatch(c -> c == 200);
        mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.profile.heightCm").value("180.5"))
                .andExpect(jsonPath("$.profile.goal").value("GAIN_MUSCLE"));
    }

    // initialIntakeAt is set-once: a second kcal update must not move the anchor timestamp.
    @Test
    void initialIntakeAtIsSetOnce() throws Exception {
        String t = register("intake@example.com");
        mvc.perform(put("/api/me/profile").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"initialIntakeKcal\":2500}"))
                .andExpect(status().isOk());
        Object first = ((org.bson.Document) rawUser(meId(t)).get("profile")).get("initialIntakeAt");
        assertThat(first).isNotNull();
        mvc.perform(put("/api/me/profile").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"initialIntakeKcal\":2600}"))
                .andExpect(status().isOk());
        org.bson.Document p = (org.bson.Document) rawUser(meId(t)).get("profile");
        assertThat(p.get("initialIntakeAt")).as("set-once anchor never moves").isEqualTo(first);
        assertThat(p.get("initialIntakeKcal")).isEqualTo(2600);
    }

    // Derive-on-read (RED pre-fix): a stale stored mirror must never be served; the value is computed
    // from the log — latest NON-estimated entry — so an estimated import row can't poison it either.
    @Test
    void currentBodyweightIsDerivedNotStaleMirror() throws Exception {
        String t = register("derive@example.com");
        assertThat(addBwStatus(t, "80.5")).isEqualTo(200);
        String uid = meId(t);
        // seed a stale mirror + a NEWER estimated raw entry — neither may win over the real 80.5
        org.bson.Document estimated = new org.bson.Document("entryId", new org.bson.types.ObjectId().toHexString())
                .append("recordedAt", java.util.Date.from(java.time.Instant.now().plusSeconds(3600)))
                .append("weightKg", org.bson.types.Decimal128.parse("90"))
                .append("estimated", true);
        mongo.getDb().getCollection("users").updateOne(
                new org.bson.Document("_id", new org.bson.types.ObjectId(uid)),
                new org.bson.Document("$set", new org.bson.Document("currentBodyweightKg", org.bson.types.Decimal128.parse("70")))
                        .append("$push", new org.bson.Document("bodyweightLog", estimated)));
        mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.currentBodyweightKg").value("80.5"));
    }

    // Write-on-read elimination (RED pre-fix): a GET on a legacy doc (id-less weigh-in) must not mutate it —
    // the backfill belongs to the one-time startup runner, not the request path.
    @Test
    void getNeverWritesToLegacyDocs() throws Exception {
        String t = register("legacyget@example.com");
        String uid = meId(t);
        org.bson.Document legacy = new org.bson.Document()
                .append("recordedAt", java.util.Date.from(java.time.Instant.parse("2024-01-01T12:00:00Z")))
                .append("weightKg", org.bson.types.Decimal128.parse("77.5"))
                .append("estimated", false);   // deliberately NO id key at all
        mongo.getDb().getCollection("users").updateOne(
                new org.bson.Document("_id", new org.bson.types.ObjectId(uid)),
                new org.bson.Document("$push", new org.bson.Document("bodyweightLog", legacy)));
        mvc.perform(get("/api/me").header("Authorization", bearer(t))).andExpect(status().isOk());
        org.bson.Document entry = ((java.util.List<org.bson.Document>) (java.util.List<?>) rawUser(uid).get("bodyweightLog")).get(0);
        assertThat(entry.containsKey("_id") || entry.containsKey("entryId") || entry.containsKey("id"))
                .as("a GET must not mint ids / rewrite the doc").isFalse();
    }

    // Mirror lifecycle (review-council fix): an import-era account serves the legacy mirror UNTIL its
    // first bodyweight write ($unset in the same atomic update); after deleting the last real weigh-in
    // the value is null — never a resurrected years-stale import weight feeding effective-load/Mifflin.
    @Test
    void legacyMirrorIsRetiredOnFirstWriteNeverResurrected() throws Exception {
        String t = register("mirror@example.com");
        String uid = meId(t);
        // import shape: mirror = user-supplied real weight, log = one estimated row
        org.bson.Document est = new org.bson.Document("entryId", new org.bson.types.ObjectId().toHexString())
                .append("recordedAt", java.util.Date.from(java.time.Instant.parse("2023-01-01T12:00:00Z")))
                .append("weightKg", org.bson.types.Decimal128.parse("75"))
                .append("estimated", true);
        mongo.getDb().getCollection("users").updateOne(
                new org.bson.Document("_id", new org.bson.types.ObjectId(uid)),
                new org.bson.Document("$set", new org.bson.Document("currentBodyweightKg", org.bson.types.Decimal128.parse("75"))
                        .append("bodyweightLog", java.util.List.of(est))));
        mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.currentBodyweightKg").value("75"));      // untouched account: fallback serves
        assertThat(addBwStatus(t, "80.3")).isEqualTo(200);                       // first write retires the mirror
        mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andExpect(jsonPath("$.currentBodyweightKg").value("80.3"));    // non-binary-representable ⇒ Decimal128 held
        String id = json.readTree(mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andReturn().getResponse().getContentAsString()).get("bodyweightLog").get(1).get("id").asText();
        mvc.perform(delete("/api/me/bodyweight/" + id).header("Authorization", bearer(t))).andExpect(status().isOk());
        String afterDelete = mvc.perform(get("/api/me").header("Authorization", bearer(t)))
                .andReturn().getResponse().getContentAsString();
        assertThat(json.readTree(afterDelete).get("currentBodyweightKg").isNull())
                .as("null after deleting the last real entry — NOT a resurrected 75").isTrue();
        assertThat(rawUser(uid).containsKey("currentBodyweightKg")).as("mirror $unset by the write").isFalse();
    }

    // Startup backfill: a legacy `_id`-keyed id is PRESERVED as entryId (the client already holds it),
    // a missing one is minted once, and the second run is a no-op (self-terminating).
    @Test
    void backfillRunnerPreservesLegacyIdsAndIsIdempotent() throws Exception {
        String t = register("backfill@example.com");
        String uid = meId(t);
        org.bson.Document withLegacyId = new org.bson.Document("_id", "legacy-id-123")
                .append("recordedAt", java.util.Date.from(java.time.Instant.parse("2024-01-01T12:00:00Z")))
                .append("weightKg", org.bson.types.Decimal128.parse("76"))
                .append("estimated", false);
        org.bson.Document withNoId = new org.bson.Document()
                .append("recordedAt", java.util.Date.from(java.time.Instant.parse("2024-02-01T12:00:00Z")))
                .append("weightKg", org.bson.types.Decimal128.parse("77"))
                .append("estimated", false);
        mongo.getDb().getCollection("users").updateOne(
                new org.bson.Document("_id", new org.bson.types.ObjectId(uid)),
                new org.bson.Document("$set", new org.bson.Document("bodyweightLog",
                        java.util.List.of(withLegacyId, withNoId))));

        assertThat(backfill.backfillAll()).as("first run remediates the doc").isEqualTo(1);
        java.util.List<org.bson.Document> log =
                ((java.util.List<org.bson.Document>) (java.util.List<?>) rawUser(uid).get("bodyweightLog"));
        assertThat(log.get(0).getString("entryId")).as("legacy _id survives as entryId").isEqualTo("legacy-id-123");
        assertThat(log.get(0).containsKey("_id")).isFalse();
        assertThat(log.get(1).getString("entryId")).as("missing id is minted").isNotBlank();
        assertThat(backfill.backfillAll()).as("second run is a no-op").isEqualTo(0);

        // the backfilled id is live: the client can amend through it
        mvc.perform(patch("/api/me/bodyweight/legacy-id-123").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"weightKg\":\"78.5\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bodyweightLog[0].weightKg").value("78.5"));
    }

    /** A missing static asset must be a 404, not the opaque 500 it used to be (which also fired a Sentry
     *  event on every browser /favicon.ico request). Real SPA deep-link forwarding needs the bundled
     *  index.html (only present after the Docker build), so it is covered by the Playwright e2e, not here. */
    @Test
    void missingStaticResourceReturns404NotServerError() throws Exception {
        mvc.perform(get("/assets/does-not-exist.js")).andExpect(status().isNotFound());
        mvc.perform(get("/favicon.ico")).andExpect(status().isNotFound());
    }

    // ── Concurrency regression pins: a delete/end must not be silently overwritten by a stale versioned save ──
    // (load-test council P1/P2). The council theorised a silent resurrection: softDelete/endActive use
    // updateFirst/updateMulti (no manual .inc("version")), so a concurrent full-edit/advance whose read straddled
    // the delete could save() over it and revive deletedAt→null / status→ACTIVE with no 500 (a lost-delete Sentry
    // can't catch). EMPIRICALLY the app is already SAFE: Spring Data MongoDB auto-increments the @Version property
    // on updateFirst/updateMulti (since Data-Mongo 2.2), so the delete bumps version 0→1 and the stale save() loses
    // with OptimisticLockingFailureException. These tests PASS on the current code — they pin that invariant so a
    // future switch to a raw update, or dropping @Version, re-introduces the race and fails here.

    @Test
    void softDeletedWorkoutCannotBeResurrectedByAStaleVersionedWrite() throws Exception {
        String token = register("resurrect-workout@example.com");
        String exId = createExercise(token, "Bench", false);
        String wid = createWorkout(token, exId, "60.0", 8);

        // A concurrent full edit (PUT → replaceExercises → mongo.save(w)) read the live workout (version 0).
        com.workoutlogger.domain.Workout stale = mongo.findById(wid, com.workoutlogger.domain.Workout.class);
        assertThat(stale.getVersion()).isEqualTo(0L);
        assertThat(stale.getDeletedAt()).isNull();

        // The owner deletes it.
        mvc.perform(delete("/api/workouts/" + wid).header("Authorization", bearer(token)))
                .andExpect(status().is2xxSuccessful());

        // The stale edit's save() must LOSE (softDelete bumped @Version) — not resurrect deletedAt→null.
        stale.setExercises(java.util.List.of());
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> mongo.save(stale))
                .isInstanceOf(org.springframework.dao.OptimisticLockingFailureException.class);

        // The workout stays deleted.
        com.workoutlogger.domain.Workout current = mongo.findById(wid, com.workoutlogger.domain.Workout.class);
        assertThat(current.getDeletedAt()).as("still soft-deleted, not resurrected").isNotNull();
        mvc.perform(get("/api/workouts/" + wid).header("Authorization", bearer(token)))
                .andExpect(status().isNotFound());
    }

    @Test
    void endedPlanCannotBeResurrectedByAStaleAdvance() throws Exception {
        String token = register("resurrect-plan@example.com");
        String planRes = mvc.perform(post("/api/plan").header("Authorization", bearer(token))
                        .contentType(MediaType.APPLICATION_JSON).content(planBody("EndRace")))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String planId = json.readTree(planRes).get("id").asText();

        // A concurrent advance() read the ACTIVE plan (version 0) before the end lands.
        com.workoutlogger.domain.Macrocycle stale =
                mongo.findById(planId, com.workoutlogger.domain.Macrocycle.class);
        assertThat(stale.getVersion()).isEqualTo(0L);
        assertThat(stale.getStatus()).isEqualTo("ACTIVE");

        // The owner ends the plan.
        mvc.perform(delete("/api/plan").header("Authorization", bearer(token)))
                .andExpect(status().is2xxSuccessful());

        // The stale advance's save() must LOSE (endActive bumped @Version) — not resurrect status→ACTIVE.
        stale.setWeek(stale.getWeek() + 1);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> mongo.save(stale))
                .isInstanceOf(org.springframework.dao.OptimisticLockingFailureException.class);

        com.workoutlogger.domain.Macrocycle current =
                mongo.findById(planId, com.workoutlogger.domain.Macrocycle.class);
        assertThat(current.getStatus()).as("stays ENDED, not resurrected to ACTIVE").isEqualTo("ENDED");
    }

}
