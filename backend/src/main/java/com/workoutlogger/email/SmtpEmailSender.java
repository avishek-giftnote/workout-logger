package com.workoutlogger.email;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

/**
 * Real transactional {@link EmailSender} over SMTP (Spring's {@link JavaMailSender}). Provider-agnostic — point
 * {@code spring.mail.*} at any SMTP relay (SendGrid, Mailgun, Amazon SES, Postmark, Gmail, …). Active whenever
 * {@code email.sender=smtp}, in any profile, so prod delivers real codes (and you can smoke it in dev too);
 * it takes precedence over the {@code prod} {@link NoOpEmailSender}, which is gated to {@code email.sender=noop}.
 *
 * <p>Requires SMTP config (at minimum {@code spring.mail.host}) — Spring Boot only auto-configures a
 * {@link JavaMailSender} when that is set, so {@code email.sender=smtp} without mail config fails fast at
 * startup (a missing-bean error) rather than silently dropping mail. {@code email.from} sets the From address.
 * Never logs the code (a plaintext message body is a secret). See DESIGN.md §6b.
 */
@Component
@ConditionalOnProperty(name = "email.sender", havingValue = "smtp")
public class SmtpEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(SmtpEmailSender.class);

    private final JavaMailSender mail;
    private final String from;

    public SmtpEmailSender(JavaMailSender mail,
                           @Value("${email.from:no-reply@workout-logger.app}") String from) {
        this.mail = mail;
        this.from = from;
    }

    @Override
    public void send(String to, String subject, String body) {
        SimpleMailMessage msg = new SimpleMailMessage();
        msg.setFrom(from);
        msg.setTo(to);
        msg.setSubject(subject);
        msg.setText(body);
        try {
            mail.send(msg);
            log.info("[email:smtp] sent to={} subject=\"{}\"", to, subject);   // never log the body/code
        } catch (MailException e) {
            // Surface as a 500 so the caller retries — but never leak the code. Verified sign-up will show a
            // generic failure and the user can request a fresh code.
            log.error("[email:smtp] delivery failed to={} subject=\"{}\": {}", to, subject, e.getMessage());
            throw e;
        }
    }
}
