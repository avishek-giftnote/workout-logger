package com.workoutlogger.security;

import io.jsonwebtoken.JwtException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JwtServiceTest {

    private static MockEnvironment env(String... profiles) {
        MockEnvironment e = new MockEnvironment();
        e.setActiveProfiles(profiles);
        return e;
    }

    private static JwtProperties props(String secret) {
        JwtProperties p = new JwtProperties();
        p.setSecret(secret);
        return p;
    }

    /** Default (non-prod) profile + blank secret → ephemeral random key, as in dev/tests/e2e. */
    private JwtService service() {
        return new JwtService(new JwtProperties(), env());
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

    // ── M7: fail-fast on a blank secret under the 'prod' profile ──

    @Test
    void prodWithBlankSecretFailsFast() {
        assertThatThrownBy(() -> new JwtService(props(""), env("prod")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("SECURITY_JWT_SECRET");
    }

    @Test
    void nonProdWithBlankSecretAllowsEphemeralKey() {
        assertThatCode(() -> new JwtService(props(""), env())).doesNotThrowAnyException();
    }

    @Test
    void prodWithStrongSecretStarts() {
        String strong = "this-is-a-sufficiently-long-hs256-secret-key";   // 44 bytes // pragma: allowlist secret
        assertThat(strong.getBytes().length).isGreaterThanOrEqualTo(32);
        assertThatCode(() -> new JwtService(props(strong), env("prod"))).doesNotThrowAnyException();
    }
}
