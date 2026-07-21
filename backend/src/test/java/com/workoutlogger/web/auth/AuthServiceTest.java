package com.workoutlogger.web.auth;

import com.workoutlogger.domain.AuthChallenge.Purpose;
import com.workoutlogger.email.EmailSender;
import com.workoutlogger.email.EmailTemplates;
import com.workoutlogger.importer.DefaultExerciseSeeder;
import com.workoutlogger.repo.AuthChallengeRepository;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.AuthProperties;
import com.workoutlogger.security.JwtService;
import org.junit.jupiter.api.Test;
import org.springframework.mail.MailSendException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Pure unit tests for {@link AuthService} (no Spring/DB). Pins the enumeration-neutrality fix from the review
 * council: a failed email dispatch must NOT propagate out of the request methods, else a send failure would
 * surface as a 500 for a registered address vs the neutral 202 for an unknown one — a status oracle.
 */
class AuthServiceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final AuthChallengeRepository challenges = mock(AuthChallengeRepository.class);
    private final EmailSender email = mock(EmailSender.class);
    private final AuthService svc = new AuthService(users, challenges, mock(PasswordEncoder.class),
            mock(JwtService.class), mock(DefaultExerciseSeeder.class), email, new EmailTemplates(), new AuthProperties());

    // A send failure inside /signup/request is swallowed — the endpoint still completes (→ 202), no 500 leak.
    @Test
    void requestSignupSwallowsEmailSendFailure() {
        when(users.existsByEmail("new@example.com")).thenReturn(false);   // free email → proceeds to send
        when(challenges.incrementSend(anyString(), any(Purpose.class), any(Instant.class), any(Instant.class))).thenReturn(1);
        doThrow(new MailSendException("smtp down")).when(email).send(anyString(), anyString(), anyString());

        assertThatCode(() -> svc.requestSignup("new@example.com")).doesNotThrowAnyException();
        verify(email).send(eq("new@example.com"), anyString(), anyString());   // it DID attempt the send
    }

    // Same for /recover/request — a known email whose send fails must not 500 (which would enumerate it).
    @Test
    void requestRecoverySwallowsEmailSendFailure() {
        when(users.existsByEmail("known@example.com")).thenReturn(true);   // real account → proceeds to send
        when(challenges.incrementSend(anyString(), any(Purpose.class), any(Instant.class), any(Instant.class))).thenReturn(1);
        doThrow(new MailSendException("smtp down")).when(email).send(anyString(), anyString(), anyString());

        assertThatCode(() -> svc.requestRecovery("known@example.com")).doesNotThrowAnyException();
        verify(email).send(eq("known@example.com"), anyString(), anyString());
    }

    // The per-email send cap short-circuits BEFORE minting/sending: over-cap requests attempt no send at all.
    @Test
    void requestRecoveryOverSendCapDoesNotSend() {
        when(users.existsByEmail("known@example.com")).thenReturn(true);
        when(challenges.incrementSend(anyString(), any(Purpose.class), any(Instant.class), any(Instant.class)))
                .thenReturn(new AuthProperties().getMaxSendsPerHour() + 1);   // over the cap

        assertThatCode(() -> svc.requestRecovery("known@example.com")).doesNotThrowAnyException();
        verify(email, never()).send(anyString(), anyString(), anyString());
        verify(challenges, never()).setCode(anyString(), any(Purpose.class), anyString(), any(Instant.class), any(Instant.class));
    }
}
