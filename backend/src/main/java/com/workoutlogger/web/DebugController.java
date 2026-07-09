package com.workoutlogger.web;

import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Verification aid for the Sentry pipeline — NON-PRODUCTION ONLY. {@code @Profile("!prod")} means this
 * controller is not registered under the {@code prod} profile, so the endpoint cannot be reached in production.
 *
 * <p>{@code GET /api/debug/sentry-error} throws an unhandled {@link RuntimeException}, which falls through to
 * {@code ApiExceptionHandler.generic()} → {@code Sentry.captureException} — i.e. a genuine unhandled 500. Use it
 * to confirm the backend Sentry project receives the event, and that the {@code Authorization} header + request
 * body are scrubbed from it. Requires a valid JWT (like every {@code /api/**} route), which is deliberate: the
 * request carries a Bearer token, so the captured event proves the {@code beforeSend} scrub actually strips it.
 */
@RestController
@RequestMapping("/api/debug")
@Profile("!prod")
public class DebugController {

    @GetMapping("/sentry-error")
    public String sentryError() {
        throw new RuntimeException("Sentry verification: deliberate backend 500 from /api/debug/sentry-error");
    }
}
