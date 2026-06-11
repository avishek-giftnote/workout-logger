package com.workoutlogger.importer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.mongodb.core.MongoTemplate;

import java.io.InputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class DefaultExerciseSeederTest {

    @Test
    void defaultCatalogLoadsAndParses() {
        var seeder = new DefaultExerciseSeeder(mock(MongoTemplate.class), new ObjectMapper());
        assertThat(seeder.count()).isGreaterThanOrEqualTo(80);   // the shared starting catalog
    }

    /** Every STRENGTH exercise must have a muscle at ≥0.5 so the planner's crediting basis can select it
     *  (the Deadlift/Rack Pull regression: no fraction was ≥0.5 and they were invisible to the planner). */
    @Test
    void everyStrengthExerciseIsSelectableAtThePlannerThreshold() throws Exception {
        try (InputStream in = new ClassPathResource("default-exercises.json").getInputStream()) {
            JsonNode arr = new ObjectMapper().readTree(in);
            for (JsonNode e : arr) {
                if (!"STRENGTH".equals(e.get("category").asText())) continue;
                double max = 0;
                for (JsonNode m : e.get("muscles")) max = Math.max(max, Double.parseDouble(m.get("fraction").asText()));
                assertThat(max).as("%s has no ≥0.5 muscle → planner-invisible", e.get("name").asText())
                        .isGreaterThanOrEqualTo(0.5);
            }
        }
    }
}
