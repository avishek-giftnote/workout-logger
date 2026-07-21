package com.workoutlogger.security;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class AuthCodesTest {

    // ── A1: the 6-digit code hash is PEPPERED — the stored value differs from a bare SHA-256(code), so a DB
    //    dump can't precompute the 10^6 code space offline (bypassing the online attempt cap). ──
    @Test
    void codeHashIsPepperedNotBareSha256() {
        String code = "123456";
        String peppered = AuthCodes.hash(code, "a-real-pepper");
        String bare = AuthCodes.hash(code, "");
        assertThat(peppered).isNotEqualTo(bare);
        assertThat(peppered).hasSize(64);   // SHA-256 hex
    }

    // ── A2: hashing is deterministic (same code+pepper → same hash) and constant-time compare matches. ──
    @Test
    void hashIsStableAndMatches() {
        String a = AuthCodes.hash("000111", "p");
        String b = AuthCodes.hash("000111", "p");
        assertThat(AuthCodes.matches(a, b)).isTrue();
        assertThat(AuthCodes.matches(a, AuthCodes.hash("000112", "p"))).isFalse();
        assertThat(AuthCodes.matches(null, a)).isFalse();
    }

    // ── A3: codes are 6 digits (zero-padded), opaque tokens are 64 hex chars (256-bit), and both vary. ──
    @Test
    void codeAndTokenShape() {
        for (int i = 0; i < 50; i++) {
            assertThat(AuthCodes.sixDigitCode()).matches("\\d{6}");
        }
        assertThat(AuthCodes.opaqueToken()).matches("[0-9a-f]{64}");
        assertThat(AuthCodes.opaqueToken()).isNotEqualTo(AuthCodes.opaqueToken());
    }
}
