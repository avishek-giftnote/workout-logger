package com.workoutlogger.importer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.MongoTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class DefaultExerciseSeederTest {

    @Test
    void defaultCatalogLoadsAndParses() {
        var seeder = new DefaultExerciseSeeder(mock(MongoTemplate.class), new ObjectMapper());
        assertThat(seeder.count()).isGreaterThanOrEqualTo(80);   // the shared starting catalog
    }
}
