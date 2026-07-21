package com.workoutlogger.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Default {@link EmailSender}: writes the message to the application log. No provider, no secrets — the
 * verification code / recovery link is visible in DEV logs so the flow is fully exercisable without wiring a
 * real email service. Active unless {@code email.sender=file} selects {@link FileEmailSender}.
 *
 * <p>{@code @Profile("!prod")}: this stub (which prints the code to the log) MUST NOT be the prod binding —
 * that would leak every sign-up code into log aggregation. Under prod there is deliberately no fallback sender,
 * so the app fails to start until a real provider is wired (delivery is out of scope this iteration) rather than
 * silently logging secrets.
 */
@Component
@Profile("!prod")
@ConditionalOnProperty(name = "email.sender", havingValue = "log", matchIfMissing = true)
public class LoggingEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(LoggingEmailSender.class);

    @Override
    public void send(String to, String subject, String body) {
        log.info("[email:dev] to={} subject=\"{}\"\n{}", to, subject, body);
    }
}
