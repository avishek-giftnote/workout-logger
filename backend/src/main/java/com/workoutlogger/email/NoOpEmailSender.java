package com.workoutlogger.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Prod fallback {@link EmailSender} — active ONLY under the {@code prod} profile (the dev {@link LoggingEmailSender}
 * and the E2E {@link FileEmailSender} are {@code @Profile("!prod")}). It logs a loud WARN that no real email
 * provider is wired and DROPS the message WITHOUT logging the verification code (so prod logs never leak a secret).
 *
 * <p>Consequence: verified sign-up can't deliver codes in prod until a real provider replaces this (the deferred
 * "real email delivery" slice). This bean exists so the app still BOOTS — the alternative (no EmailSender bean at
 * all) crashes startup, which is what broke the Railway deploy. Wire a real provider, then delete this / gate it
 * behind {@code email.sender}.
 */
@Component
@Profile("prod")
public class NoOpEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(NoOpEmailSender.class);

    @Override
    public void send(String to, String subject, String body) {
        log.warn("[email] No real email provider configured — message to {} (\"{}\") was NOT delivered "
                + "and its contents are suppressed. Verified sign-up cannot complete in prod until an email "
                + "provider is wired.", to, subject);
    }
}
