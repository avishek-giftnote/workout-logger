package com.workoutlogger.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;

/**
 * A file "outbox" {@link EmailSender} for out-of-process E2E tests (Playwright runs in a separate process
 * and can't read an in-JVM capture). Appends one message per line to {@code target/email-outbox.log}, and
 * writes the newest per-recipient message to {@code target/email-outbox/<sha-safe email>.txt} so the test
 * can read the freshest code/link deterministically. DOUBLE-GATED: only active when {@code email.sender=file}
 * AND the profile is NOT {@code prod} — a same-machine file, never a network endpoint (the council rejected
 * any HTTP reveal-code route). The outbox dir is git-ignored.
 */
@Component
@Profile("!prod")
@ConditionalOnProperty(name = "email.sender", havingValue = "file")
public class FileEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(FileEmailSender.class);
    private final Path dir = Path.of("target", "email-outbox");
    private final Path feed = Path.of("target", "email-outbox.log");

    @Override
    public void send(String to, String subject, String body) {
        try {
            Files.createDirectories(dir);
            Files.writeString(dir.resolve(safe(to) + ".txt"),
                    "subject: " + subject + "\n" + body, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            Files.writeString(feed, Instant.now() + " to=" + to + " subject=" + subject + " | " + body + "\n",
                    StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            log.error("FileEmailSender failed to write outbox for {}", to, e);
        }
    }

    /** A filesystem-safe filename derived from the recipient. */
    static String safe(String email) {
        return email.toLowerCase().replaceAll("[^a-z0-9._-]", "_");
    }
}
