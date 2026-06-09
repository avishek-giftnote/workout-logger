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

    /** Account that owns the imported history (created if absent), so it is reachable via login. */
    private String userEmail = "importer@example.com";

    /** Password set when the import account is created (ignored if the account already exists). */
    private String userPassword = "changeme-via-env";

    public String getCsvPath() { return csvPath; }
    public void setCsvPath(String csvPath) { this.csvPath = csvPath; }
    public BigDecimal getCurrentBodyweightKg() { return currentBodyweightKg; }
    public void setCurrentBodyweightKg(BigDecimal v) { this.currentBodyweightKg = v; }
    public boolean isPersist() { return persist; }
    public void setPersist(boolean persist) { this.persist = persist; }
    public String getUserEmail() { return userEmail; }
    public void setUserEmail(String userEmail) { this.userEmail = userEmail; }
    public String getUserPassword() { return userPassword; }
    public void setUserPassword(String userPassword) { this.userPassword = userPassword; }
}
