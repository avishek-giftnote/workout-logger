package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Application user. {@code bodyweightLog} drives the bodyweight-exercise effective-load math and
 * the input placeholder; the latest entry is the current bodyweight. See DESIGN.md §5.
 */
@Document(collection = "users")
public class User {

    @Id
    private String id;
    private String email;
    private BigDecimal currentBodyweightKg;          // convenience mirror of latest log entry
    private List<BodyweightEntry> bodyweightLog = new ArrayList<>();
    private int schemaVersion = 1;
    private Instant createdAt;
    private Instant updatedAt;

    public User() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
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
