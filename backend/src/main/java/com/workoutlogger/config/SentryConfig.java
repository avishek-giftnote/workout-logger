package com.workoutlogger.config;

import io.sentry.SentryOptions;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Defence-in-depth PII scrubbing for Sentry events. {@code send-default-pii} is already false (so IP, cookies,
 * and PII request headers are not attached, and request bodies are not captured), but this makes it explicit:
 * even if a future change flips a default, an event can never carry the user's JWT (sent as an
 * {@code Authorization: Bearer} header), cookies, or a request body out to Sentry.
 *
 * <p>The Sentry Spring Boot starter auto-applies a {@link SentryOptions.BeforeSendCallback} bean. This runs
 * only on events actually being sent — i.e. the unhandled-500 reports from
 * {@code ApiExceptionHandler.generic()} — so it never touches expected 4xx flows (which are never reported).
 */
@Configuration
class SentryConfig {

    @Bean
    SentryOptions.BeforeSendCallback scrubPii() {
        return (event, hint) -> {
            var request = event.getRequest();
            if (request != null) {
                request.setCookies(null);
                request.setData(null);   // never ship a request body
                var headers = request.getHeaders();
                if (headers != null) {
                    headers.remove("Authorization");
                    headers.remove("Cookie");
                }
            }
            return event;
        };
    }
}
