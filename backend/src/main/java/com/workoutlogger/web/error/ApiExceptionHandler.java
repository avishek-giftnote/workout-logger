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
