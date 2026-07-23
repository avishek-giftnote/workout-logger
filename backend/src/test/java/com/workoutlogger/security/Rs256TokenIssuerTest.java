package com.workoutlogger.security;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.workoutlogger.security.oauth.OAuthKeyProvider;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Guards the first-party token issuer (docs/mcp-hosting.md Phase 3). The properties that matter are the
 * ones {@code JwtAuthenticationFilter} depends on: the algorithm is RS256, the AS's own JWKS validates it,
 * and it carries {@code sub} / {@code tv} / {@code aud} / {@code scope}. Pure — no Spring context.
 */
class Rs256TokenIssuerTest {

    private static final String USER_ID = "64f0c0ffee0000000000abcd";
    private static final String AUDIENCE = "workout-logger-api";
    private static final String ISSUER = "https://workout-logger.example";

    private final RSAKey key = OAuthKeyProvider.generate();
    private final JWKSource<SecurityContext> jwks = new ImmutableJWKSet<>(new JWKSet(key));

    private Rs256TokenIssuer issuer(String iss) {
        JwtProperties props = new JwtProperties();
        props.setExpiryMinutes(60);
        return new Rs256TokenIssuer(jwks, props, AUDIENCE, iss);
    }

    private Jwt decode(String token) throws Exception {
        JwtDecoder decoder = NimbusJwtDecoder.withPublicKey(key.toRSAPublicKey()).build();
        return decoder.decode(token);
    }

    @Test
    void mintsAnRs256TokenTheAsKeyValidates() throws Exception {
        Jwt jwt = decode(issuer(ISSUER).issue(USER_ID, 0));
        assertThat(String.valueOf(jwt.getHeaders().get("alg"))).isEqualTo("RS256");
        assertThat(jwt.getSubject()).isEqualTo(USER_ID);
    }

    /** The revocation claim gate G1 reads. Minting at the wrong version would lock the account out. */
    @Test
    void carriesTheUsersTokenVersion() throws Exception {
        assertThat(((Number) decode(issuer(ISSUER).issue(USER_ID, 7)).getClaim("tv")).intValue()).isEqualTo(7);
    }

    /** Without `aud` naming this API, the filter's confused-deputy check would reject our own token. */
    @Test
    void bindsTheTokenToThisApiAudience() throws Exception {
        assertThat(decode(issuer(ISSUER).issue(USER_ID, 0)).getAudience()).containsExactly(AUDIENCE);
    }

    /**
     * The SPA is the user acting on their own account, so its token must carry the FULL scope set —
     * otherwise Phase 4's {@code @PreAuthorize} on the destructive endpoints would lock the app out of
     * its own delete/end-plan actions.
     */
    @Test
    void firstPartyTokenCarriesEveryScopeIncludingDestructive() throws Exception {
        String scope = decode(issuer(ISSUER).issue(USER_ID, 0)).getClaim("scope");
        assertThat(scope)
                .contains(Rs256TokenIssuer.SCOPE_READ)
                .contains(Rs256TokenIssuer.SCOPE_WRITE)
                .contains(Rs256TokenIssuer.SCOPE_DESTRUCTIVE);
    }

    @Test
    void stampsTheIssuerWhenConfigured() throws Exception {
        assertThat(decode(issuer(ISSUER).issue(USER_ID, 0)).getClaimAsString("iss")).isEqualTo(ISSUER);
    }

    /** Dev has no configured issuer; omitting the claim beats stamping a wrong one. */
    @Test
    void omitsTheIssuerClaimWhenNotConfigured() throws Exception {
        assertThat(decode(issuer("").issue(USER_ID, 0)).getClaimAsString("iss")).isNull();
    }

    @Test
    void aLongerLifetimePushesExpiryOut() throws Exception {
        var shortLived = decode(issuer(ISSUER).issue(USER_ID, 0, 60)).getExpiresAt();
        var longLived = decode(issuer(ISSUER).issue(USER_ID, 0, 60 * 24 * 30)).getExpiresAt();
        assertThat(longLived).isAfter(shortLived);
    }

    /** Signature is the trust root: a token from any other key must not validate against ours. */
    @Test
    void aTokenSignedByAnotherKeyIsRejected() throws Exception {
        RSAKey attacker = OAuthKeyProvider.generate();
        JwtProperties props = new JwtProperties();
        String forged = new Rs256TokenIssuer(
                new ImmutableJWKSet<>(new JWKSet(attacker)), props, AUDIENCE, ISSUER).issue(USER_ID, 0);

        assertThatThrownBy(() -> decode(forged)).isInstanceOf(JwtException.class);
    }
}
