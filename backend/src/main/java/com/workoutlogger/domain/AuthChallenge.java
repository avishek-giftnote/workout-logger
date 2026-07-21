package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * A pending sign-up (SIGNUP) or password-recovery (RESET) challenge — the ONLY place an unverified email
 * "waits", so the User doc is never half-created. At most one live challenge per {email, purpose} (atomic
 * upsert replaces on re-request). The secret is stored ONLY hashed ({@code codeHash} for the peppered
 * 6-digit sign-up code, {@code tokenHash} for the 256-bit recovery token); expiry + single-use + the attempt
 * cap are all enforced in code (indexes are hygiene only). Derive-on-read: nothing here is authoritative user
 * state. NOT medical data.
 */
@Document("authChallenges")
public class AuthChallenge {

    public enum Purpose { SIGNUP, RESET }

    @Id
    private String id;
    private String email;
    private Purpose purpose;
    private String codeHash;      // SIGNUP: SHA-256(code + pepper)
    private String tokenHash;     // RESET: SHA-256(256-bit token)
    private int attempts;         // failed verify attempts (locks out at the cap)
    private int sends;            // emails actually dispatched in the current window (per-email send cap)
    private Instant windowStartAt;
    private Instant createdAt;
    private Instant expiresAt;

    public AuthChallenge() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public Purpose getPurpose() { return purpose; }
    public void setPurpose(Purpose purpose) { this.purpose = purpose; }
    public String getCodeHash() { return codeHash; }
    public void setCodeHash(String codeHash) { this.codeHash = codeHash; }
    public String getTokenHash() { return tokenHash; }
    public void setTokenHash(String tokenHash) { this.tokenHash = tokenHash; }
    public int getAttempts() { return attempts; }
    public void setAttempts(int attempts) { this.attempts = attempts; }
    public int getSends() { return sends; }
    public void setSends(int sends) { this.sends = sends; }
    public Instant getWindowStartAt() { return windowStartAt; }
    public void setWindowStartAt(Instant windowStartAt) { this.windowStartAt = windowStartAt; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public void setExpiresAt(Instant expiresAt) { this.expiresAt = expiresAt; }
}
