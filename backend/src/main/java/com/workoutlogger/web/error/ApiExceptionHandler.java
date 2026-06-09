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
