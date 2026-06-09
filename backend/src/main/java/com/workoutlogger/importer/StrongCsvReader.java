package com.workoutlogger.importer;

import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the Strong CSV into ordered header->value maps. Commons-CSV handles quoted fields
 * (notes contain commas) and CRLF line endings. Row order is preserved (it is authoritative
 * for set/exercise ordering — the export has no per-set timestamps).
 */
public class StrongCsvReader {

    /** The 12 Strong export columns, in order. */
    public static final List<String> COLUMNS = List.of(
            "Date", "Workout Name", "Duration", "Exercise Name", "Set Order",
            "Weight", "Reps", "Distance", "Seconds", "Notes", "Workout Notes", "RPE");

    public List<Map<String, String>> read(Path csvPath) {
        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader()
                .setSkipHeaderRecord(true)
                .build();
        List<Map<String, String>> rows = new ArrayList<>();
        try (Reader reader = Files.newBufferedReader(csvPath, StandardCharsets.UTF_8);
             CSVParser parser = CSVParser.parse(reader, format)) {
            for (CSVRecord record : parser) {
                Map<String, String> row = new LinkedHashMap<>();
                for (String col : COLUMNS) {
                    row.put(col, record.isMapped(col) ? record.get(col) : "");
                }
                rows.add(row);
            }
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read Strong CSV at " + csvPath, e);
        }
        return rows;
    }
}
