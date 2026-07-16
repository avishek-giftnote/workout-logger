package com.workoutlogger.web.error;

import io.sentry.Sentry;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.OptimisticLockingFailureException;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guard for the Sentry capture design (Stage A): the ONLY exception handler that reports to Sentry is the
 * generic 500 fallback. Every expected 4xx handler must report NOTHING — otherwise client errors (a 404 for
 * someone else's workout, a duplicate-key 409, a bad body 400) would flood Sentry and bury real bugs.
 *
 * <p>No Spring context / Mongo / real DSN: we init Sentry with a dummy DSN and a counting {@code beforeSend}
 * that drops the event (returns null → never hits the network), then invoke the handler methods directly and
 * assert how many events each path produced. This pins "500-only, exactly-once" so a refactor can't regress it.
 */
class ApiExceptionHandlerSentryTest {

    private static final AtomicInteger CAPTURED = new AtomicInteger();
    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    @BeforeAll
    static void initSentry() {
        Sentry.init(options -> {
            options.setDsn("https://public@localhost/1");   // dummy — beforeSend drops every event
            options.setBeforeSend((event, hint) -> {
                CAPTURED.incrementAndGet();
                return null;   // don't actually send; we only want the count
            });
        });
    }

    @AfterAll
    static void closeSentry() {
        Sentry.close();   // reset global state so sibling tests get a clean (disabled) hub
    }

    @Test
    void unhandled500IsReportedExactlyOnce() {
        int before = CAPTURED.get();
        handler.generic(new RuntimeException("boom"));
        assertThat(CAPTURED.get() - before).isEqualTo(1);
    }

    @Test
    void expectedClientErrorsAreNeverReported() {
        int before = CAPTURED.get();
        handler.notFound(new ApiExceptions.NotFoundException("nope"));
        handler.badRequest(new ApiExceptions.BadRequestException("bad"));
        handler.conflict(new ApiExceptions.ConflictException("dup", null));
        handler.duplicateKey(new DuplicateKeyException("dup key"));
        handler.optimisticLock(new OptimisticLockingFailureException("stale"));
        assertThat(CAPTURED.get() - before).isZero();
    }

    /** A missing static resource (favicon.ico, a stale asset hash, a .map probe) is a 404 — never a Sentry
     *  event. Before the NoResourceFoundException handler existed it fell through to generic() → 500, firing
     *  an event on every browser favicon request. */
    @Test
    void missingStaticResourceIs404AndNeverReported() {
        int before = CAPTURED.get();
        var res = handler.noStaticResource(new org.springframework.web.servlet.resource.NoResourceFoundException(
                org.springframework.http.HttpMethod.GET, "/favicon.ico"));
        assertThat(res.getStatusCode().value()).isEqualTo(404);
        assertThat(CAPTURED.get() - before).isZero();
    }

    /** QA-01: a wrong HTTP method on a mapped route is a 405 (with an Allow header) — never a Sentry event.
     *  Before this handler existed HttpRequestMethodNotSupportedException fell through to generic() → 500,
     *  firing a false event on every mis-verbed request. */
    @Test
    void wrongMethodIs405WithAllowHeaderAndNeverReported() {
        int before = CAPTURED.get();
        var res = handler.methodNotSupported(new org.springframework.web.HttpRequestMethodNotSupportedException(
                "DELETE", java.util.List.of("GET", "POST")));
        assertThat(res.getStatusCode().value()).isEqualTo(405);
        assertThat(res.getHeaders().getAllow()).contains(
                org.springframework.http.HttpMethod.GET, org.springframework.http.HttpMethod.POST);
        assertThat(CAPTURED.get() - before).isZero();
    }

    /** QA-01: an unsupported request Content-Type is a 415 — never a Sentry event. */
    @Test
    void unsupportedMediaTypeIs415AndNeverReported() {
        int before = CAPTURED.get();
        var res = handler.unsupportedMediaType(
                new org.springframework.web.HttpMediaTypeNotSupportedException("text/plain not supported"));
        assertThat(res.getStatusCode().value()).isEqualTo(415);
        assertThat(CAPTURED.get() - before).isZero();
    }

    /** QA-01: an unsatisfiable Accept header is a 406 with a forced JSON body (so it can't re-enter content
     *  negotiation) — never a Sentry event. Uniquely insidious: unmapped it fired Sentry in generic() while
     *  the client still saw 406 from the failed re-write of the 500 body. */
    @Test
    void notAcceptableIs406WithJsonBodyAndNeverReported() {
        int before = CAPTURED.get();
        var res = handler.notAcceptable(
                new org.springframework.web.HttpMediaTypeNotAcceptableException("application/xml not producible"));
        assertThat(res.getStatusCode().value()).isEqualTo(406);
        assertThat(res.getHeaders().getContentType()).isEqualTo(org.springframework.http.MediaType.APPLICATION_JSON);
        assertThat(CAPTURED.get() - before).isZero();
    }
}
