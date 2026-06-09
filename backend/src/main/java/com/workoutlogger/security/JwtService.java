package com.workoutlogger.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    public JwtService(JwtProperties props) {
        String secret = props.getSecret();
        if (secret == null || secret.isBlank()) {
            this.key = Jwts.SIG.HS256.key().build();   // ephemeral random key (dev only)
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
