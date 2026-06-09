package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * A named grouping of templates (e.g. an "Anterior/Posterior" split). Many-to-many with templates:
 * a split references 0+ template ids, and a template may appear in 0+ splits.
 */
@Document(collection = "splits")
public class Split {

    @Id
    private String id;
    private String userId;
    private String name;
    private List<String> templateIds = new ArrayList<>();
    private int schemaVersion = 1;
    private Instant createdAt;
    private Instant updatedAt;

    public Split() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<String> getTemplateIds() { return templateIds; }
    public void setTemplateIds(List<String> templateIds) { this.templateIds = templateIds; }
    public int getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(int schemaVersion) { this.schemaVersion = schemaVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
