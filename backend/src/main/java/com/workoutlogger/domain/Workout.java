package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;
import org.springframework.data.mongodb.core.mapping.Field;

import java.time.Instant;
import java.util.List;

/**
 * A workout session — the core aggregate. Embeds its exercises and sets so a whole session
 * loads/saves atomically (the dominant access pattern). See DESIGN.md §2.
 */
@Document(collection = "workouts")
public class Workout {

    @Id
    private String id;                  // client-mintable ObjectId hex (DESIGN §3.5)

    private String userId;              // owner; every query ANDs this in (DESIGN §3.3)

    @Version
    private Long version;               // optimistic lock against concurrent set writes (DESIGN §3.4)

    private Instant startedAt;          // session start (UTC instant)
    private String startedAtOffset;     // original local offset, if known (import: null)
    private Integer durationSeconds;    // parsed, authoritative for display
    private String rawDurationText;     // original "1h 24m" text (lossless)
    private String templateId;          // optional link to the template this session came from
    private CyclePhase cyclePhase;      // ACCUMULATION/DELOAD; DELOAD is excluded from progression trends

    private List<ExerciseBlock> exercises;
    private List<Muscle> soreMuscles;   // muscles the user reported still sore at session start (readiness; nullable)

    @Field("schemaVersion")
    private int schemaVersion = 1;

    private Instant createdAt;
    private Instant updatedAt;
    private Instant deletedAt;          // soft-delete tombstone (null = live)

    public Workout() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public String getStartedAtOffset() { return startedAtOffset; }
    public void setStartedAtOffset(String startedAtOffset) { this.startedAtOffset = startedAtOffset; }
    public Integer getDurationSeconds() { return durationSeconds; }
    public void setDurationSeconds(Integer durationSeconds) { this.durationSeconds = durationSeconds; }
    public String getRawDurationText() { return rawDurationText; }
    public void setRawDurationText(String rawDurationText) { this.rawDurationText = rawDurationText; }
    public String getTemplateId() { return templateId; }
    public void setTemplateId(String templateId) { this.templateId = templateId; }
    public CyclePhase getCyclePhase() { return cyclePhase; }
    public void setCyclePhase(CyclePhase cyclePhase) { this.cyclePhase = cyclePhase; }
    public List<ExerciseBlock> getExercises() { return exercises; }
    public void setExercises(List<ExerciseBlock> exercises) { this.exercises = exercises; }
    public List<Muscle> getSoreMuscles() { return soreMuscles; }
    public void setSoreMuscles(List<Muscle> soreMuscles) { this.soreMuscles = soreMuscles; }
    public int getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(int schemaVersion) { this.schemaVersion = schemaVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public void setDeletedAt(Instant deletedAt) { this.deletedAt = deletedAt; }
}
