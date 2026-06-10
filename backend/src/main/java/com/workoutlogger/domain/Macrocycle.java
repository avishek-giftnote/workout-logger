package com.workoutlogger.domain;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * A training plan: an ordered sequence of {@link Mesocycle}s (the macrocycle), with a cursor pointing at
 * the current mesocycle + microcycle (week). week 1..accumulationWeeks = accumulation; week
 * accumulationWeeks+1 = deload. One ACTIVE macrocycle per user at a time. See docs/coach.md.
 */
@Document(collection = "plans")
public class Macrocycle {

    @Id
    private String id;
    private String userId;
    private String name;
    private Instant startedAt;
    private String status = "ACTIVE";        // ACTIVE | COMPLETED
    private int mesoIndex = 0;               // current mesocycle (0-based)
    private int week = 1;                    // current week within that mesocycle (1-based)
    private List<Mesocycle> mesocycles = new ArrayList<>();
    private Instant createdAt;
    private Instant updatedAt;

    public Macrocycle() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public int getMesoIndex() { return mesoIndex; }
    public void setMesoIndex(int mesoIndex) { this.mesoIndex = mesoIndex; }
    public int getWeek() { return week; }
    public void setWeek(int week) { this.week = week; }
    public List<Mesocycle> getMesocycles() { return mesocycles; }
    public void setMesocycles(List<Mesocycle> mesocycles) { this.mesocycles = mesocycles; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
