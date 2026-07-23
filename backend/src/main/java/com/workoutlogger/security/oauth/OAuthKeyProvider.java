package com.workoutlogger.security.oauth;

import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.text.ParseException;
import java.util.UUID;

/**
 * Resolves the RSA signing key for the OAuth Authorization Server (RS256 / JWKS).
 *
 * <p>Dev/prod key discipline: a configured key is REQUIRED under the {@code prod}
 * profile — a stable key must survive restarts and be identical across replicas, since a regenerated key
 * would invalidate every issued token and every client's cached JWKS. Dev/test generate an ephemeral key
 * with a warning so the app runs without configuration.
 *
 * <p>The key is supplied as a JWK JSON string ({@code OAUTH_SIGNING_JWK}), not PEM, so Nimbus parses it
 * directly with no PKCS8 wrangling. Key rotation (multiple keys + {@code kid} selection) is a later
 * hardening (docs/mcp-hosting.md, Phase 6). Pure + Spring-free so it is unit-testable.
 */
public final class OAuthKeyProvider {

    private static final Logger log = LoggerFactory.getLogger(OAuthKeyProvider.class);

    private OAuthKeyProvider() {}

    /**
     * @param jwkJson a JWK JSON containing the RSA private key, or null/blank to auto-generate
     * @param prod    whether the {@code prod} profile is active (blank key ⇒ fail-fast, no ephemeral fallback)
     * @return the RSA signing key (always private)
     */
    public static RSAKey resolve(String jwkJson, boolean prod) {
        if (jwkJson == null || jwkJson.isBlank()) {
            if (prod) {
                throw new IllegalStateException("OAUTH_SIGNING_JWK is required under the 'prod' profile "
                        + "(a stable RSA JWK JSON); refusing to start with an ephemeral OAuth signing key.");
            }
            log.warn("No OAUTH_SIGNING_JWK set — generated an ephemeral RSA signing key; OAuth tokens will not "
                    + "survive a restart and won't validate across replicas. Set OAUTH_SIGNING_JWK for stable auth.");
            return generate();
        }
        try {
            RSAKey key = RSAKey.parse(jwkJson);
            if (!key.isPrivate()) {
                throw new IllegalStateException("OAUTH_SIGNING_JWK must include the RSA private key material.");
            }
            return key;
        } catch (ParseException e) {
            throw new IllegalStateException("OAUTH_SIGNING_JWK is not a valid JWK JSON", e);
        }
    }

    /** A fresh 2048-bit RSA JWK with a random key id (also serves as the ephemeral dev key). */
    public static RSAKey generate() {
        try {
            return new RSAKeyGenerator(2048)
                    .keyID(UUID.randomUUID().toString())
                    .generate();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to generate an RSA signing key", e);
        }
    }
}
