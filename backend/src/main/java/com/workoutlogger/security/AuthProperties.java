package com.workoutlogger.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds {@code security.auth.*} — the sign-up / recovery challenge knobs.
 *
 * <p>{@code pepper} is a server-side secret mixed into the low-entropy 6-digit sign-up code before hashing
 * (a bare SHA-256 of a 6-digit code is offline-precomputable from a DB dump in milliseconds, bypassing the
 * online attempt cap; one HMAC-with-pepper closes that). Provided via {@code AUTH_TOKEN_PEPPER}; env-only,
 * never committed. Blank ⇒ a fixed dev/test constant (fine locally; set a real one for any shared deploy).
 */
@ConfigurationProperties(prefix = "security.auth")
public class AuthProperties {

    private String pepper = "";
    private int codeExpiryMinutes = 15;
    private int maxVerifyAttempts = 5;
    /** Max sign-up/recovery emails actually sent per address per rolling window (enumeration-neutral: the
     *  endpoint still returns 202, it just stops sending). */
    private int maxSendsPerHour = 5;
    private long rememberMeDays = 30;
    private long sessionHours = 24;

    /** Dev/test fallback so the app runs without configuration; NOT a real secret. */
    public String effectivePepper() {
        return (pepper == null || pepper.isBlank()) ? "dev-only-auth-pepper-not-for-shared-deploys" : pepper;
    }

    public String getPepper() { return pepper; }
    public void setPepper(String pepper) { this.pepper = pepper; }
    public int getCodeExpiryMinutes() { return codeExpiryMinutes; }
    public void setCodeExpiryMinutes(int v) { this.codeExpiryMinutes = v; }
    public int getMaxVerifyAttempts() { return maxVerifyAttempts; }
    public void setMaxVerifyAttempts(int v) { this.maxVerifyAttempts = v; }
    public int getMaxSendsPerHour() { return maxSendsPerHour; }
    public void setMaxSendsPerHour(int v) { this.maxSendsPerHour = v; }
    public long getRememberMeDays() { return rememberMeDays; }
    public void setRememberMeDays(long v) { this.rememberMeDays = v; }
    public long getSessionHours() { return sessionHours; }
    public void setSessionHours(long v) { this.sessionHours = v; }
}
