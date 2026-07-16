package com.workoutlogger.web.error;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiExceptions.NotFoundException.class)
    public ResponseEntity<Map<String, Object>> notFound(ApiExceptions.NotFoundException e) {
        return body(HttpStatus.NOT_FOUND, e.getMessage(), null);
    }

    @ExceptionHandler(ApiExceptions.ConflictException.class)
    public ResponseEntity<Map<String, Object>> conflict(ApiExceptions.ConflictException e) {
        return body(HttpStatus.CONFLICT, e.getMessage(), e.getDetail());
    }

    @ExceptionHandler(ApiExceptions.BadRequestException.class)
    public ResponseEntity<Map<String, Object>> badRequest(ApiExceptions.BadRequestException e) {
        return body(HttpStatus.BAD_REQUEST, e.getMessage(), null);
    }

    // A unique-index collision — the loser of a register / createPlan race (the DB-level guard fired). Map to
    // 409 so the client can retry cleanly, rather than the opaque 500 the generic handler would return.
    @ExceptionHandler(org.springframework.dao.DuplicateKeyException.class)
    public ResponseEntity<Map<String, Object>> duplicateKey(org.springframework.dao.DuplicateKeyException e) {
        return body(HttpStatus.CONFLICT, "Already exists — a concurrent request won; please retry.", null);
    }

    // A concurrent @Version mismatch — two simultaneous advance() writes raced and the loser's save found a
    // bumped version. Map to 409 (not the opaque 500) so the client can re-read and retry. (audit H2)
    @ExceptionHandler(org.springframework.dao.OptimisticLockingFailureException.class)
    public ResponseEntity<Map<String, Object>> optimisticLock(org.springframework.dao.OptimisticLockingFailureException e) {
        return body(HttpStatus.CONFLICT, "Conflicting concurrent update — please retry.", null);
    }

    // Malformed JSON or an unparseable body reaches the converter, not a controller. Without this the generic
    // handler returns 500; a bad request body is the client's fault → 400. (audit M2)
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> notReadable(org.springframework.http.converter.HttpMessageNotReadableException e) {
        return body(HttpStatus.BAD_REQUEST, "Malformed request body.", null);
    }

    // A path/query/header param that won't bind to its target type — e.g. a non-numeric If-Match header
    // hitting a Long parameter. Without this the generic handler returns 500; it's the client's fault → 400.
    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> typeMismatch(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException e) {
        return body(HttpStatus.BAD_REQUEST, "Malformed request parameter: " + e.getName(), null);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .findFirst().orElse("validation failed");
        return body(HttpStatus.BAD_REQUEST, msg, null);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, Object>> denied(AccessDeniedException e) {
        return body(HttpStatus.FORBIDDEN, "Access denied", null);
    }

    // Spring 6 throws NoResourceFoundException when a static resource is missing — /favicon.ico, a stale
    // /assets/<hash>.js, or a .map probe. SpaForwardController deliberately excludes dotted paths, so those
    // reach the resource handler and, with no mapping here, fell through to generic() → 500. That is wrong
    // twice over: a missing file is a CLIENT error (404), and the 500 fired a Sentry event on *every browser
    // favicon request*. Found live on Railway. Pinned by ApiExceptionHandlerSentryTest + ApiIntegrationTest.
    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> noStaticResource(
            org.springframework.web.servlet.resource.NoResourceFoundException e) {
        return body(HttpStatus.NOT_FOUND, "Not found", null);
    }

    // A wrong HTTP method on a *mapped* route (e.g. DELETE /api/workouts, which maps only GET/POST). Spring
    // raises HttpRequestMethodNotSupportedException; with no mapping here it fell through to generic() → 500,
    // which is wrong twice over: a method mismatch is a CLIENT error (405), and the 500 fired a Sentry event on
    // every mis-verbed request (scanners, mis-coded clients) — the same false-flood class as the #40 static-404
    // fix. Found live on Railway (QA-01, hosted sweep). The Allow header advertises the supported methods
    // (RFC 7231 §7.4.1). Pinned by ApiExceptionHandlerSentryTest + ApiIntegrationTest.
    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> methodNotSupported(
            org.springframework.web.HttpRequestMethodNotSupportedException e) {
        var res = body(HttpStatus.METHOD_NOT_ALLOWED, "Method not allowed", null);
        var supported = e.getSupportedHttpMethods();
        if (supported != null && !supported.isEmpty()) {
            return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                    .allow(supported.toArray(new org.springframework.http.HttpMethod[0]))
                    .body(res.getBody());
        }
        return res;
    }

    // An unsupported request Content-Type on a body route (e.g. text/plain to a JSON-consuming POST). Spring
    // raises HttpMediaTypeNotSupportedException; unmapped it fell through to generic() → 500. It's a CLIENT
    // error → 415, and like every 4xx must never reach the Sentry-reporting generic handler. (QA-01)
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> unsupportedMediaType(
            org.springframework.web.HttpMediaTypeNotSupportedException e) {
        return body(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported media type", null);
    }

    // A client Accept header this JSON-only app can't satisfy (e.g. Accept: application/xml). Reachable on
    // every read endpoint. This one was insidious: unmapped, generic() ran (firing Sentry) AND returned a
    // 500 body that itself couldn't be written as the requested type, so re-negotiation surfaced a 406 to the
    // client — the status looked fine while a false Sentry event fired underneath (caught only by the
    // dispatch-level capture guard, not a status assertion). Force JSON on the error body so the 406 itself
    // writes cleanly and never re-enters this negotiation. 406 is a CLIENT error → no Sentry. (QA-01)
    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotAcceptableException.class)
    public ResponseEntity<Map<String, Object>> notAcceptable(
            org.springframework.web.HttpMediaTypeNotAcceptableException e) {
        return ResponseEntity.status(HttpStatus.NOT_ACCEPTABLE)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(body(HttpStatus.NOT_ACCEPTABLE, "Not acceptable", null).getBody());
    }

    // preserve explicit status exceptions (e.g. login 401) before the generic fallback below
    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> responseStatus(org.springframework.web.server.ResponseStatusException e) {
        HttpStatus s = HttpStatus.valueOf(e.getStatusCode().value());
        return body(s, e.getReason() != null ? e.getReason() : s.getReasonPhrase(), null);
    }

    // last-resort: never leak a stack trace / internal message to the client — but DO log it server-side,
    // otherwise an unexpected 500 is completely opaque (no trace anywhere).
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> generic(Exception e) {
        log.error("Unhandled exception → 500", e);
        // Report to Sentry ONLY here: this is the single place a genuinely unexpected 500 is produced. Every
        // 4xx is caught by a more specific @ExceptionHandler above and returns before reaching this method, so
        // this call site is inherently 500-only (no config-based exclusion list needed). No-op when the SDK is
        // disabled (blank DSN). Pinned by ApiExceptionHandlerSentryTest.
        io.sentry.Sentry.captureException(e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "Internal error", null);
    }

    private ResponseEntity<Map<String, Object>> body(HttpStatus status, String message, Object detail) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("timestamp", Instant.now().toString());
        m.put("status", status.value());
        m.put("error", status.getReasonPhrase());
        m.put("message", message);
        if (detail != null) m.put("detail", detail);
        return ResponseEntity.status(status).body(m);
    }
}
