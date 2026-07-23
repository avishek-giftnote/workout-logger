package com.workoutlogger.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds {@code security.jwt.*} — now only the first-party token lifetime.
 *
 * <p>The HMAC secret is gone: since the Phase-3 cutover (docs/mcp-hosting.md) the first-party token is
 * RS256, signed by the Authorization Server key ({@code OAUTH_SIGNING_JWK}), so there is no second signing
 * secret. A leftover {@code SECURITY_JWT_SECRET} in the environment is simply ignored.
 */
@ConfigurationProperties(prefix = "security.jwt")
public class JwtProperties {

    /** First-party (SPA) token lifetime in minutes. */
    private long expiryMinutes = 60 * 24 * 7;   // 7 days

    public long getExpiryMinutes() { return expiryMinutes; }
    public void setExpiryMinutes(long expiryMinutes) { this.expiryMinutes = expiryMinutes; }
}
