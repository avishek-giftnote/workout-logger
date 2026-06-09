package com.workoutlogger.web.error;

/** Lightweight API exceptions mapped to HTTP status by {@link ApiExceptionHandler}. */
public final class ApiExceptions {

    private ApiExceptions() {}

    /** 404 — resource not found (or not owned by the current user, which looks the same). */
    public static class NotFoundException extends RuntimeException {
        public NotFoundException(String message) { super(message); }
    }

    /** 409 — e.g. an exercise with the same normalized name already exists. */
    public static class ConflictException extends RuntimeException {
        private final Object detail;
        public ConflictException(String message, Object detail) {
            super(message);
            this.detail = detail;
        }
        public Object getDetail() { return detail; }
    }

    /** 400 — bad client input not caught by bean validation. */
    public static class BadRequestException extends RuntimeException {
        public BadRequestException(String message) { super(message); }
    }
}
