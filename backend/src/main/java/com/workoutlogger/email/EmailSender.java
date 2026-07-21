package com.workoutlogger.email;

/**
 * Outbound email port. The default binding is {@link LoggingEmailSender} (writes the message to the log,
 * persists nothing secret); a real provider is a config-only follow-up (out of scope this iteration —
 * flows are fully built + testable, delivery stubbed). See {@link EmailTemplates} for the message copy.
 */
public interface EmailSender {
    void send(String to, String subject, String body);
}
