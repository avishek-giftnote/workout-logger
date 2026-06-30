package com.workoutlogger.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

/** Issues and verifies HS256 JWTs whose subject is the user id. */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    private final SecretKey key;
    private final long expiryMinutes;

    public JwtService(JwtProperties props, Environment env) {
        String secret = props.getSecret();
        // Fail-fast (audit M7): under the 'prod' profile a blank secret must NOT silently fall back to an
        // ephemeral key — that logs every user out on each VM restart and signs differently per replica.
        // Refuse to start instead. Outside prod (dev / tests / e2e) the ephemeral fallback is kept so the
        // app runs without configuration. (A < 32-byte secret already throws via Keys.hmacShaKeyFor in any
        // profile, so M7 only has to cover the blank case.)
        boolean prod = env.acceptsProfiles(Profiles.of("prod"));
        if (secret == null || secret.isBlank()) {
            if (prod) {
                throw new IllegalStateException("SECURITY_JWT_SECRET is required under the 'prod' profile "
                        + "(>= 32 bytes); refusing to start with an ephemeral signing key.");
            }
            this.key = Jwts.SIG.HS256.key().build();   // ephemeral random key (dev/test only)
            log.warn("No SECURITY_JWT_SECRET set — generated an ephemeral signing key; tokens will "
                    + "not survive a restart. Set SECURITY_JWT_SECRET (>= 32 bytes) for stable auth.");
        } else {
            this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        }
        this.expiryMinutes = props.getExpiryMinutes();
    }

    public String issue(String userId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(expiryMinutes, ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();
    }

    /** @return the user id (subject) if the token is valid; throws JwtException otherwise. */
    public String verifyAndGetUserId(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getSubject();
    }
}
