package com.workoutlogger.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Binds {@code security.ratelimit.*} — the per-IP throttle on the open auth endpoints (audit finding C2).
 *
 * @param enabled       master switch (default true). Tests that fire many requests from one IP set this false.
 * @param capacity      max requests per IP per window before a 429 (default 10).
 * @param windowSeconds the fixed-window length in seconds (default 60).
 */
@ConfigurationProperties(prefix = "security.ratelimit")
public record RateLimitProperties(
        @DefaultValue("true") boolean enabled,
        @DefaultValue("10") int capacity,
        @DefaultValue("60") long windowSeconds) {
}
