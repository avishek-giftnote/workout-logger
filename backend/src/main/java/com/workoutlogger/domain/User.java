package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Application user. {@code bodyweightLog} drives the bodyweight-exercise effective-load math and
 * the input placeholder; the latest entry is the current bodyweight. See DESIGN.md §5.
 */
@Document(collection = "users")
public class User {

    @Id
    private String id;
    private String email;
    private String passwordHash;                     // BCrypt hash (never serialized to the API)
    private BigDecimal currentBodyweightKg;          // convenience mirror of latest log entry
    private List<BodyweightEntry> bodyweightLog = new ArrayList<>();
    private Profile profile;                          // nullable fitness profile (see docs/coach.md)
    private Map<String, String> settings = new HashMap<>();   // device-synced UI prefs (local-first; cloud sync premium)
    private long settingsUpdatedAt;                   // epoch millis of the last settings write (for last-write-wins)
    private int schemaVersion = 1;
    private Instant createdAt;
    private Instant updatedAt;

    public User() {}

    public Profile getProfile() { return profile; }
    public void setProfile(Profile profile) { this.profile = profile; }

    public Map<String, String> getSettings() { return settings; }
    public void setSettings(Map<String, String> settings) { this.settings = settings; }
    public long getSettingsUpdatedAt() { return settingsUpdatedAt; }
    public void setSettingsUpdatedAt(long settingsUpdatedAt) { this.settingsUpdatedAt = settingsUpdatedAt; }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String passwordHash) { this.passwordHash = passwordHash; }
    public BigDecimal getCurrentBodyweightKg() { return currentBodyweightKg; }
    public void setCurrentBodyweightKg(BigDecimal v) { this.currentBodyweightKg = v; }
    public List<BodyweightEntry> getBodyweightLog() { return bodyweightLog; }
    public void setBodyweightLog(List<BodyweightEntry> log) { this.bodyweightLog = log; }
    public int getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(int schemaVersion) { this.schemaVersion = schemaVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
