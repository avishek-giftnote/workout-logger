package com.workoutlogger.security;

import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class JwtServiceTest {

    private JwtService service() {
        JwtProperties p = new JwtProperties();   // default 58-char secret, 7-day expiry
        return new JwtService(p);
    }

    @Test
    void roundTripsUserId() {
        JwtService jwt = service();
        String token = jwt.issue("user-123");
        assertEquals("user-123", jwt.verifyAndGetUserId(token));
    }

    @Test
    void rejectsTamperedToken() {
        JwtService jwt = service();
        String token = jwt.issue("user-123");
        String tampered = token.substring(0, token.length() - 2) + (token.endsWith("a") ? "bb" : "aa");
        assertThrows(JwtException.class, () -> jwt.verifyAndGetUserId(tampered));
    }

    @Test
    void rejectsGarbage() {
        assertThrows(JwtException.class, () -> service().verifyAndGetUserId("not-a-jwt"));
    }
}
