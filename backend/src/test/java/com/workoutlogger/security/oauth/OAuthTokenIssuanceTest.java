package com.workoutlogger.security.oauth;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Phase-1 core guard: the AS's RSA key mints an RS256 JWT that the matching JWKS validates, carrying the
 * exact claims the design requires — {@code sub} = userId, {@code tv} (revocation), {@code aud}
 * (confused-deputy binding), {@code scope}. Pure crypto round-trip: no Spring context, Mongo, or browser
 * flow. Also pins that a token signed by a DIFFERENT key is rejected (signature is the trust root).
 */
class OAuthTokenIssuanceTest {

    private static final String USER_ID = "64f0c0ffee0000000000abcd";

    @Test
    void rs256TokenRoundTripsWithRequiredClaims() throws Exception {
        RSAKey rsaKey = OAuthKeyProvider.generate();
        JWKSource<SecurityContext> jwks = new ImmutableJWKSet<>(new JWKSet(rsaKey));
        JwtEncoder encoder = new NimbusJwtEncoder(jwks);

        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(USER_ID)
                .audience(List.of("workout-logger-api"))
                .claim("tv", 3)
                .claim("scope", "workout:read workout:write")
                .issuedAt(now)
                .expiresAt(now.plus(15, ChronoUnit.MINUTES))
                .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId(rsaKey.getKeyID()).build();

        Jwt encoded = encoder.encode(JwtEncoderParameters.from(header, claims));
        assertEquals("RS256", String.valueOf(encoded.getHeaders().get("alg")));

        JwtDecoder decoder = NimbusJwtDecoder.withPublicKey(rsaKey.toRSAPublicKey()).build();
        Jwt decoded = decoder.decode(encoded.getTokenValue());

        assertEquals(USER_ID, decoded.getSubject());
        assertEquals(3, ((Number) decoded.getClaim("tv")).intValue());
        assertEquals(List.of("workout-logger-api"), decoded.getAudience());
        assertTrue(decoded.<String>getClaim("scope").contains("workout:write"));
    }

    @Test
    void aTokenSignedByADifferentKeyIsRejected() throws Exception {
        RSAKey signing = OAuthKeyProvider.generate();
        RSAKey attacker = OAuthKeyProvider.generate();

        JwtEncoder attackerEncoder = new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(attacker)));
        Instant now = Instant.now();
        Jwt forged = attackerEncoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(SignatureAlgorithm.RS256).keyId(attacker.getKeyID()).build(),
                JwtClaimsSet.builder().subject("evil").issuedAt(now).expiresAt(now.plusSeconds(60)).build()));

        JwtDecoder decoder = NimbusJwtDecoder.withPublicKey(signing.toRSAPublicKey()).build();
        assertThrows(JwtException.class, () -> decoder.decode(forged.getTokenValue()));
    }
}
