package com.workoutlogger.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

/**
 * Optional fitness profile embedded on {@link User}. All fields nullable so existing accounts load
 * unchanged. Inputs only — TDEE/phase are derived on read (see docs/coach.md). NOT medical data.
 */
public class Profile {

    private LocalDate dateOfBirth;
    private BigDecimal heightCm;
    private Sex sex;
    private Goal goal;
    private ActivityLevel activityLevel;
    private Integer initialIntakeKcal;   // entered once
    private Instant initialIntakeAt;
    private Instant updatedAt;

    public Profile() {}

    public LocalDate getDateOfBirth() { return dateOfBirth; }
    public void setDateOfBirth(LocalDate dateOfBirth) { this.dateOfBirth = dateOfBirth; }
    public BigDecimal getHeightCm() { return heightCm; }
    public void setHeightCm(BigDecimal heightCm) { this.heightCm = heightCm; }
    public Sex getSex() { return sex; }
    public void setSex(Sex sex) { this.sex = sex; }
    public Goal getGoal() { return goal; }
    public void setGoal(Goal goal) { this.goal = goal; }
    public ActivityLevel getActivityLevel() { return activityLevel; }
    public void setActivityLevel(ActivityLevel activityLevel) { this.activityLevel = activityLevel; }
    public Integer getInitialIntakeKcal() { return initialIntakeKcal; }
    public void setInitialIntakeKcal(Integer initialIntakeKcal) { this.initialIntakeKcal = initialIntakeKcal; }
    public Instant getInitialIntakeAt() { return initialIntakeAt; }
    public void setInitialIntakeAt(Instant initialIntakeAt) { this.initialIntakeAt = initialIntakeAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
