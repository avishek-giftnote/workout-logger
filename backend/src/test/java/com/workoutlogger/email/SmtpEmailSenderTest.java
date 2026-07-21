package com.workoutlogger.email;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class SmtpEmailSenderTest {

    // ── S1: send() builds a SimpleMailMessage with the configured From and the given to/subject/body, and
    //    delegates to JavaMailSender exactly once. ──
    @Test
    void buildsAndSendsTheMessage() {
        JavaMailSender mail = mock(JavaMailSender.class);
        new SmtpEmailSender(mail, "no-reply@example.com").send("lifter@example.com", "Your code", "Code: 123456");

        ArgumentCaptor<SimpleMailMessage> cap = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mail, times(1)).send(cap.capture());
        SimpleMailMessage m = cap.getValue();
        assertThat(m.getFrom()).isEqualTo("no-reply@example.com");
        assertThat(m.getTo()).containsExactly("lifter@example.com");
        assertThat(m.getSubject()).isEqualTo("Your code");
        assertThat(m.getText()).isEqualTo("Code: 123456");
    }

    // ── S2: a delivery failure propagates (so the caller 500s + the user can retry), and the exception message
    //    never carries the code — only what the mail layer reported. ──
    @Test
    void propagatesDeliveryFailure() {
        JavaMailSender mail = mock(JavaMailSender.class);
        doThrow(new MailSendException("smtp refused")).when(mail).send(any(SimpleMailMessage.class));
        assertThatThrownBy(() ->
                new SmtpEmailSender(mail, "no-reply@example.com").send("x@example.com", "s", "Code: 999999"))
                .isInstanceOf(MailSendException.class)
                .hasMessageContaining("smtp refused")
                .hasMessageNotContaining("999999");
    }
}
