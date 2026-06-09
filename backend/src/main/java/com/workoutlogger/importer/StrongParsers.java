package com.workoutlogger.importer;

import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure parsing helpers for the Strong CSV — shared by importer and tests, no Spring/Mongo deps.
 * These mirror the verified reference (tools/verify_import.py) exactly.
 */
public final class StrongParsers {

    private StrongParsers() {}

    /** Strong dates: "2026-03-12 7:03:20 PM" — 12-hour, AM/PM, lenient on hour digits. */
    private static final DateTimeFormatter STRONG_DATE = new DateTimeFormatterBuilder()
            .parseCaseInsensitive()
            .appendPattern("yyyy-MM-dd h:mm:ss a")
            .toFormatter(Locale.ENGLISH);

    private static final Pattern DURATION = Pattern.compile(
            "^\\s*(?:(\\d+)h)?\\s*(?:(\\d+)m)?\\s*(?:(\\d+)s)?\\s*$");

    /**
     * 🚨 Replace U+202F (narrow no-break space) and U+00A0 (no-break space) with ASCII space.
     * Every Strong date contains U+202F before AM/PM; without this, date parsing fails silently.
     */
    public static String normalizeWhitespace(String s) {
        if (s == null) return null;
        return s.replace('\u202f', ' ').replace('\u00a0', ' ');  // narrow + no-break space -> ASCII
    }

    /** Normalized dedup key for exercise names: NFC + lower-case + collapse internal whitespace. */
    public static String nameKey(String name) {
        if (name == null) return null;
        String nfc = Normalizer.normalize(name, Normalizer.Form.NFC);
        return nfc.trim().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    /** NFC-normalize a display name but keep it otherwise verbatim. */
    public static String normalizeName(String name) {
        return name == null ? null : Normalizer.normalize(name, Normalizer.Form.NFC);
    }

    /**
     * Parse a Strong timestamp to an Instant. The export carries no timezone, so we interpret the
     * local wall-clock at a fixed import zone (UTC) — documented approximation (DESIGN.md §7).
     */
    public static Instant parseStartedAt(String raw) {
        LocalDateTime ldt = LocalDateTime.parse(normalizeWhitespace(raw).trim(), STRONG_DATE);
        return ldt.toInstant(ZoneOffset.UTC);
    }

    /** Parse the 4 verified duration shapes (#h #m, #h, #m, #s) to seconds; null if blank. */
    public static Integer parseDurationSeconds(String raw) {
        if (raw == null || raw.isBlank()) return null;
        Matcher m = DURATION.matcher(raw.trim());
        if (!m.matches() || (m.group(1) == null && m.group(2) == null && m.group(3) == null)) {
            throw new IllegalArgumentException("unparseable duration: '" + raw + "'");
        }
        int h = m.group(1) == null ? 0 : Integer.parseInt(m.group(1));
        int mi = m.group(2) == null ? 0 : Integer.parseInt(m.group(2));
        int se = m.group(3) == null ? 0 : Integer.parseInt(m.group(3));
        return h * 3600 + mi * 60 + se;
    }
}
