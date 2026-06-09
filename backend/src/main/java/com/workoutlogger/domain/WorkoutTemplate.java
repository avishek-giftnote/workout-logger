package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

/**
 * A reusable workout template, reconstructed at import from the most-recent instance of each
 * scoped Strong workout name, so "start next workout" is one tap. See DESIGN.md §4.
 */
@Document(collection = "templates")
public class WorkoutTemplate {

    @Id
    private String id;
    private String userId;
    private String name;
    private List<TemplateExercise> exercises;
    private int schemaVersion = 1;
    private Instant createdAt;
    private Instant updatedAt;

    public WorkoutTemplate() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public List<TemplateExercise> getExercises() { return exercises; }
    public void setExercises(List<TemplateExercise> exercises) { this.exercises = exercises; }
    public int getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(int schemaVersion) { this.schemaVersion = schemaVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
