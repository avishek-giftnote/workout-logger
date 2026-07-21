package com.workoutlogger.web.auth;

import com.workoutlogger.domain.AuthChallenge;
import com.workoutlogger.domain.AuthChallenge.Purpose;
import com.workoutlogger.domain.User;
import com.workoutlogger.email.EmailSender;
import com.workoutlogger.email.EmailTemplates;
import com.workoutlogger.importer.DefaultExerciseSeeder;
import com.workoutlogger.repo.AuthChallengeRepository;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.AuthCodes;
import com.workoutlogger.security.AuthProperties;
import com.workoutlogger.security.JwtService;
import com.workoutlogger.web.auth.AuthDtos.AuthResponse;
import com.workoutlogger.web.error.ApiExceptions.BadRequestException;
import org.bson.types.ObjectId;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;

/**
 * Verified sign-up: request a code (enumeration-neutral, rate-capped) → verify the code + set a password,
 * which is the ONLY point an account is created. The User doc never exists until verify succeeds, so no
 * half-account is ever persisted. Codes are stored only hashed (peppered) and are single-use with an
 * attempt cap. See docs/coach.md-adjacent auth notes / the auth council decision.
 */
@Service
public class AuthService {

    private final UserRepository users;
    private final AuthChallengeRepository challenges;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final DefaultExerciseSeeder seeder;
    private final EmailSender email;
    private final EmailTemplates templates;
    private final AuthProperties props;

    public AuthService(UserRepository users, AuthChallengeRepository challenges, PasswordEncoder encoder,
                       JwtService jwt, DefaultExerciseSeeder seeder, EmailSender email,
                       EmailTemplates templates, AuthProperties props) {
        this.users = users;
        this.challenges = challenges;
        this.encoder = encoder;
        this.jwt = jwt;
        this.seeder = seeder;
        this.email = email;
        this.templates = templates;
        this.props = props;
    }

    static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Start a sign-up: if the email is free, mint a fresh 6-digit code, store it hashed, and email it.
     * ALWAYS returns normally (the endpoint replies with an identical 202 regardless), so an observer can't
     * tell whether the address is registered. Per-email send cap prevents inbox-bombing; when the cap is hit
     * the existing code is preserved and no new mail is sent.
     */
    public void requestSignup(String rawEmail) {
        String e = normalize(rawEmail);
        if (users.existsByEmail(e)) return;   // already an account → neutral no-op (no code, no leak)

        Instant now = Instant.now();
        int sends = challenges.incrementSend(e, Purpose.SIGNUP, now, now.minus(Duration.ofHours(1)));
        if (sends > props.getMaxSendsPerHour()) return;   // over the per-email cap → keep old code, don't send

        String code = AuthCodes.sixDigitCode();
        challenges.setSignupCode(e, Purpose.SIGNUP, AuthCodes.hash(code, props.effectivePepper()),
                now.plus(Duration.ofMinutes(props.getCodeExpiryMinutes())), now);

        EmailTemplates.Message m = templates.signupCode(code);
        email.send(e, m.subject(), m.body());
    }

    /**
     * Complete a sign-up: validate the two passwords match, then ATOMICALLY claim one verify attempt against a
     * live, unlocked challenge (so concurrent guesses can't bypass the 5-attempt lockout — M3), check the code,
     * create the account + seed the catalog, and only THEN consume the code (create-before-consume, so a crash
     * can't strand a user with a spent code and no account). Failures are generic ("invalid or expired code").
     */
    public AuthResponse verifySignup(String rawEmail, String code, String password, String confirmPassword) {
        if (password == null || !password.equals(confirmPassword)) {
            throw new BadRequestException("Passwords do not match");
        }
        String e = normalize(rawEmail);
        Instant now = Instant.now();
        AuthChallenge c = challenges.claimSignupAttempt(e, now, props.getMaxVerifyAttempts()).orElse(null);
        boolean valid = c != null
                && AuthCodes.matches(c.getCodeHash(), AuthCodes.hash(code == null ? "" : code, props.effectivePepper()));
        if (!valid) {
            throw new BadRequestException("Invalid or expired code");   // the attempt was already counted atomically
        }
        User u = createAccount(e, password);      // create first…
        challenges.consume(e, Purpose.SIGNUP);    // …then single-use consume so a code can never be replayed
        return new AuthResponse(jwt.issue(u.getId(), u.getTokenVersion()), u.getId(), u.getEmail());
    }

    /**
     * Create + persist an account and seed its default catalog. The ONLY account-creation path (the old
     * public POST /auth/register is gone). Guards the unique-email invariant defensively (a race between
     * request and verify).
     */
    public User createAccount(String normalizedEmail, String rawPassword) {
        if (users.existsByEmail(normalizedEmail)) {
            throw new BadRequestException("Invalid or expired code");   // stay generic
        }
        Instant now = Instant.now();
        User u = new User();
        u.setId(new ObjectId().toHexString());
        u.setEmail(normalizedEmail);
        u.setPasswordHash(encoder.encode(rawPassword));
        u.setCreatedAt(now);
        u.setUpdatedAt(now);
        users.save(u);
        seeder.seed(u.getId());
        return u;
    }
}
