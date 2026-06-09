package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

/**
 * Per-user exercise catalog entry, keyed by the RAW Strong name (no equipment parsing).
 * {@code nameKey} (NFC + casefold + trim) backs a partial-unique index so live input variants
 * ("pull up" vs "Pull Up") don't fork history. See DESIGN.md §2.
 */
@Document(collection = "exercises")
public class Exercise {

    @Id
    private String id;
    private String userId;
    private String name;            // verbatim display name
    private String nameKey;         // normalized dedup key
    private boolean isBodyweight;
    private String defaultUnit;     // "kg"
    private int schemaVersion = 1;
    private Instant createdAt;
    private Instant updatedAt;
    private Instant deletedAt;

    public Exercise() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getNameKey() { return nameKey; }
    public void setNameKey(String nameKey) { this.nameKey = nameKey; }
    public boolean isBodyweight() { return isBodyweight; }
    public void setBodyweight(boolean bodyweight) { isBodyweight = bodyweight; }
    public String getDefaultUnit() { return defaultUnit; }
    public void setDefaultUnit(String defaultUnit) { this.defaultUnit = defaultUnit; }
    public int getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(int schemaVersion) { this.schemaVersion = schemaVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public void setDeletedAt(Instant deletedAt) { this.deletedAt = deletedAt; }
}
