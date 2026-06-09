package com.workoutlogger.importer;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.math.BigDecimal;

/** Binds the {@code importer.*} configuration block (see application.yml). */
@ConfigurationProperties(prefix = "importer")
public class ImportProperties {

    /** Path to the Strong CSV export. */
    private String csvPath = "../strong_workouts.csv";

    /** Current bodyweight (kg) used to backfill effective load on historical bodyweight sets. */
    private BigDecimal currentBodyweightKg = new BigDecimal("75.0");

    /** When false, parse + assert only (no MongoDB required). When true, write to MongoDB. */
    private boolean persist = false;

    public String getCsvPath() { return csvPath; }
    public void setCsvPath(String csvPath) { this.csvPath = csvPath; }
    public BigDecimal getCurrentBodyweightKg() { return currentBodyweightKg; }
    public void setCurrentBodyweightKg(BigDecimal v) { this.currentBodyweightKg = v; }
    public boolean isPersist() { return persist; }
    public void setPersist(boolean persist) { this.persist = persist; }
}
