package com.workoutlogger.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Binds {@code security.jwt.*}. The secret MUST be >= 32 bytes for HS256. */
@ConfigurationProperties(prefix = "security.jwt")
public class JwtProperties {

    /** HMAC signing secret (>= 32 bytes), provided via SECURITY_JWT_SECRET. No committed default:
     *  if blank, an ephemeral random key is generated at startup (fine for local dev). */
    private String secret = "";

    /** Token lifetime in minutes. */
    private long expiryMinutes = 60 * 24 * 7;   // 7 days

    public String getSecret() { return secret; }
    public void setSecret(String secret) { this.secret = secret; }
    public long getExpiryMinutes() { return expiryMinutes; }
    public void setExpiryMinutes(long expiryMinutes) { this.expiryMinutes = expiryMinutes; }
}
