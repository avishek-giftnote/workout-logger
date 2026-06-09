package com.workoutlogger.importer;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.*;

class StrongParsersTest {

    @Test
    void normalizesNarrowNoBreakSpace() {
        // U+202F is what Strong actually puts before AM/PM.
        String raw = "2026-03-12 7:03:20 PM";
        assertEquals("2026-03-12 7:03:20 PM", StrongParsers.normalizeWhitespace(raw));
    }

    @Test
    void parsesStrongDateWithNarrowNoBreakSpace() {
        // Must not throw — the whole import depends on this not failing silently.
        Instant t = StrongParsers.parseStartedAt("2026-03-12 7:03:20 PM");
        assertEquals(Instant.parse("2026-03-12T19:03:20Z"), t);
    }

    @Test
    void parsesAllFourDurationShapes() {
        assertEquals(5040, StrongParsers.parseDurationSeconds("1h 24m"));  // #h #m
        assertEquals(3600, StrongParsers.parseDurationSeconds("1h"));       // #h
        assertEquals(3300, StrongParsers.parseDurationSeconds("55m"));      // #m
        assertEquals(45, StrongParsers.parseDurationSeconds("45s"));        // #s
        assertNull(StrongParsers.parseDurationSeconds(""));
    }

    @Test
    void nameKeyNormalizesCaseAndWhitespace() {
        assertEquals("pull up", StrongParsers.nameKey("  Pull   Up "));
        assertEquals(StrongParsers.nameKey("pull up"), StrongParsers.nameKey("Pull Up"));
    }
}
