package com.workoutlogger.config;

import org.bson.types.Decimal128;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.mongo.MongoClientSettingsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.data.convert.ReadingConverter;
import org.springframework.data.convert.WritingConverter;
import org.springframework.data.mongodb.core.convert.MongoCustomConversions;

import java.math.BigDecimal;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Forces {@link BigDecimal} to persist as BSON {@link Decimal128} (exact decimals — no float drift).
 * 612/1,533 imported rows are fractional kg, so this is a correctness requirement (DESIGN.md §3.1).
 * The API layer serializes the same values as decimal STRINGS on the wire (separate concern).
 */
@Configuration
public class MongoConfig {

    @Bean
    public MongoCustomConversions mongoCustomConversions() {
        return new MongoCustomConversions(List.of(
                new BigDecimalToDecimal128(),
                new Decimal128ToBigDecimal()));
    }

    /**
     * Fail fast when MongoDB is unreachable (paused/blocked Atlas cluster, wrong IP allow-list, bad creds):
     * the driver's default 30s server-selection timeout makes every DB-touching request — including login —
     * hang ~30s and freeze the UI. 5s surfaces the outage promptly (the client also caps its own wait at 12s).
     * Tunable via {@code mongodb.server-selection-timeout-ms} / {@code mongodb.connect-timeout-ms}.
     */
    @Bean
    public MongoClientSettingsBuilderCustomizer mongoTimeoutCustomizer(
            @Value("${mongodb.server-selection-timeout-ms:5000}") long serverSelectionMs,
            @Value("${mongodb.connect-timeout-ms:5000}") int connectMs) {
        return builder -> builder
                .applyToClusterSettings(c -> c.serverSelectionTimeout(serverSelectionMs, TimeUnit.MILLISECONDS))
                .applyToSocketSettings(s -> s.connectTimeout(connectMs, TimeUnit.MILLISECONDS));
    }

    @WritingConverter
    static class BigDecimalToDecimal128 implements Converter<BigDecimal, Decimal128> {
        @Override
        public Decimal128 convert(BigDecimal source) {
            return new Decimal128(source);
        }
    }

    @ReadingConverter
    static class Decimal128ToBigDecimal implements Converter<Decimal128, BigDecimal> {
        @Override
        public BigDecimal convert(Decimal128 source) {
            return source.bigDecimalValue();
        }
    }
}
