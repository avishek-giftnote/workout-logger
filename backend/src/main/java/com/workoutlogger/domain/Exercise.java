package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

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
    private Equipment equipment;                       // nullable until set; BODYWEIGHT <=> isBodyweight
    private ExerciseCategory category = ExerciseCategory.STRENGTH;
    private String defaultUnit;     // "kg"
    private Integer restSeconds;                        // exercise-specific rest timer; null ⇒ use the global default
    private List<CardioMetric> cardioMetrics;          // CARDIO only: which inputs to log; null ⇒ client default
    private List<MuscleContribution> muscleContributions; // null ⇒ inferred from name on read (see docs/coach.md)
    private Laterality laterality;                      // BILATERAL/ISOLATERAL/UNILATERAL (nullable)
    private Mechanic mechanic;                          // COMPOUND/ISOLATION (nullable)
    private Boolean loadable;                           // can add/reduce resistance (esp. for bodyweight); nullable
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
    public Equipment getEquipment() { return equipment; }
    public void setEquipment(Equipment equipment) { this.equipment = equipment; }
    public ExerciseCategory getCategory() { return category; }
    public void setCategory(ExerciseCategory category) { this.category = category; }
    public String getDefaultUnit() { return defaultUnit; }
    public void setDefaultUnit(String defaultUnit) { this.defaultUnit = defaultUnit; }
    public Integer getRestSeconds() { return restSeconds; }
    public void setRestSeconds(Integer restSeconds) { this.restSeconds = restSeconds; }
    public List<CardioMetric> getCardioMetrics() { return cardioMetrics; }
    public void setCardioMetrics(List<CardioMetric> cardioMetrics) { this.cardioMetrics = cardioMetrics; }
    public List<MuscleContribution> getMuscleContributions() { return muscleContributions; }
    public void setMuscleContributions(List<MuscleContribution> v) { this.muscleContributions = v; }
    public Laterality getLaterality() { return laterality; }
    public void setLaterality(Laterality laterality) { this.laterality = laterality; }
    public Mechanic getMechanic() { return mechanic; }
    public void setMechanic(Mechanic mechanic) { this.mechanic = mechanic; }
    public Boolean getLoadable() { return loadable; }
    public void setLoadable(Boolean loadable) { this.loadable = loadable; }
    public int getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(int schemaVersion) { this.schemaVersion = schemaVersion; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public void setDeletedAt(Instant deletedAt) { this.deletedAt = deletedAt; }
}
