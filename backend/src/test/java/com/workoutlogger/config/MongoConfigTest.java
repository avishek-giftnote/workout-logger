package com.workoutlogger.config;

import com.mongodb.MongoClientSettings;
import org.junit.jupiter.api.Test;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** The timeout customizer must shorten server-selection + connect timeouts so a DB outage fails fast
 *  (the driver default is 30s, which hangs login). Pure — no Spring context, no MongoDB. */
class MongoConfigTest {

    @Test
    void appliesShortServerSelectionAndConnectTimeouts() {
        var customizer = new MongoConfig().mongoTimeoutCustomizer(5000L, 5000);
        var builder = MongoClientSettings.builder();
        customizer.customize(builder);
        var settings = builder.build();

        assertEquals(5000L, settings.getClusterSettings().getServerSelectionTimeout(TimeUnit.MILLISECONDS));
        assertEquals(5000, settings.getSocketSettings().getConnectTimeout(TimeUnit.MILLISECONDS));
    }
}
