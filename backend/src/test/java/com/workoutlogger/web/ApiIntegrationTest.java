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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * End-to-end API test. Requires a local MongoDB and is gated by RUN_MONGO_TESTS=1 so the default
 * `mvn test` (no DB) stays green. Run: RUN_MONGO_TESTS=1 mvn test
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "spring.data.mongodb.uri=mongodb://localhost:27017/workoutlogger_test")
@EnabledIfEnvironmentVariable(named = "RUN_MONGO_TESTS", matches = "1")
class ApiIntegrationTest {

    @Autowired MockMvc mvc;
    @Autowired MongoTemplate mongo;
    @Autowired ObjectMapper json;

    @BeforeEach
    void clean() {
        for (String c : new String[]{"users", "workouts", "exercises", "templates"}) {
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
}
