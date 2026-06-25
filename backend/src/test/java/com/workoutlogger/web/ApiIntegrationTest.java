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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * End-to-end API test. Requires a local MongoDB and is gated by RUN_MONGO_TESTS=1 so the default
 * `mvn test` (no DB) stays green. Run: RUN_MONGO_TESTS=1 mvn test
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "spring.data.mongodb.uri=${MONGODB_TEST_URI:mongodb://localhost:27017/workoutlogger_test}")
@EnabledIfEnvironmentVariable(named = "RUN_MONGO_TESTS", matches = "1")
class ApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired MongoTemplate mongo;
    @Autowired ObjectMapper json;

    @BeforeEach
    void clean() {
        for (String c : new String[]{"users", "workouts", "exercises", "templates", "splits", "plans"}) {
            mongo.getDb().getCollection(c).deleteMany(new org.bson.Document());
        }
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
                + "\"distanceM\":\"5200\",\"durationS\":1574,\"gradePct\":\"1.0\",\"cadenceSpm\":168}]}]}";
        mvc.perform(post("/api/workouts").header("Authorization", bearer(t))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.exercises[0].sets[0].kind").value("CARDIO"))
                .andExpect(jsonPath("$.exercises[0].sets[0].distanceM").value("5200"))
                .andExpect(jsonPath("$.exercises[0].sets[0].durationS").value(1574))
                .andExpect(jsonPath("$.exercises[0].sets[0].cadenceSpm").value(168));
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
}
