package com.workoutlogger.security.oauth;

import com.nimbusds.jose.jwk.RSAKey;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Guard for the OAuth signing-key discipline: dev auto-generates, prod fail-fasts
 * on a missing key, a provided JWK round-trips, and a public-only JWK is rejected.
 */
class OAuthKeyProviderTest {

    @Test
    void devGeneratesEphemeralPrivateKey() {
        RSAKey key = OAuthKeyProvider.resolve(null, false);
        assertTrue(key.isPrivate(), "dev key must carry private material to sign");
        assertNotNull(key.getKeyID());
    }

    @Test
    void prodFailsFastWhenKeyMissing() {
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> OAuthKeyProvider.resolve("   ", true));
        assertTrue(ex.getMessage().contains("OAUTH_SIGNING_JWK"));
    }

    @Test
    void parsesAProvidedJwkEvenInProd() {
        RSAKey generated = OAuthKeyProvider.generate();
        RSAKey parsed = OAuthKeyProvider.resolve(generated.toJSONString(), true);
        assertEquals(generated.getKeyID(), parsed.getKeyID());
        assertTrue(parsed.isPrivate());
    }

    @Test
    void rejectsAPublicOnlyJwk() {
        RSAKey publicOnly = OAuthKeyProvider.generate().toPublicJWK();
        assertThrows(IllegalStateException.class, () -> OAuthKeyProvider.resolve(publicOnly.toJSONString(), false));
    }
}
