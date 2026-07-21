package com.workoutlogger.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Prod fallback {@link EmailSender} — active under the {@code prod} profile ONLY when no real sender is configured
 * ({@code email.sender} unset or {@code noop}; setting {@code email.sender=smtp} selects {@link SmtpEmailSender}
 * instead). The dev {@link LoggingEmailSender} and E2E {@link FileEmailSender} are {@code @Profile("!prod")}. It
 * logs a loud WARN and DROPS the message WITHOUT logging the verification code (so prod logs never leak a secret).
 *
 * <p>Consequence: with no SMTP configured, verified sign-up can't deliver codes in prod. This bean exists so the
 * app still BOOTS (no {@code EmailSender} bean at all crashes startup — that broke the Railway deploy). Configure
 * {@code email.sender=smtp} + {@code spring.mail.*} for real delivery.
 */
@Component
@Profile("prod")
@ConditionalOnProperty(name = "email.sender", havingValue = "noop", matchIfMissing = true)
public class NoOpEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(NoOpEmailSender.class);

    @Override
    public void send(String to, String subject, String body) {
        log.warn("[email] No real email provider configured — message to {} (\"{}\") was NOT delivered "
                + "and its contents are suppressed. Verified sign-up cannot complete in prod until an email "
                + "provider is wired.", to, subject);
    }
}
