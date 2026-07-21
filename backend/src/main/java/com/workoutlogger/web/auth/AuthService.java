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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

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
        challenges.setCode(e, Purpose.SIGNUP, AuthCodes.hash(code, props.effectivePepper()),
                now.plus(Duration.ofMinutes(props.getCodeExpiryMinutes())), now);

        EmailTemplates.Message m = templates.signupCode(code);
        sendQuietly(e, m);
    }

    /**
     * Start a password recovery ("Retake ownership"). The MIRROR IMAGE of {@link #requestSignup}: sign-up
     * no-ops when the email EXISTS, recovery no-ops when it does NOT. Same enumeration-neutral 202, same
     * per-email send cap. CRITICAL: this NEVER touches passwordHash or tokenVersion — only {@link
     * #verifyRecovery} mutates the account. If request mutated state, anyone could force-logout or lock out
     * any victim just by requesting resets for their address.
     */
    public void requestRecovery(String rawEmail) {
        String e = normalize(rawEmail);
        if (!users.existsByEmail(e)) return;   // no account → neutral no-op (no code, no leak)

        Instant now = Instant.now();
        int sends = challenges.incrementSend(e, Purpose.RESET, now, now.minus(Duration.ofHours(1)));
        if (sends > props.getMaxSendsPerHour()) return;   // over the per-email cap → keep old code, don't send

        String code = AuthCodes.sixDigitCode();
        challenges.setCode(e, Purpose.RESET, AuthCodes.hash(code, props.effectivePepper()),
                now.plus(Duration.ofMinutes(props.getCodeExpiryMinutes())), now);

        EmailTemplates.Message m = templates.recoveryCode(code);
        sendQuietly(e, m);
    }

    /**
     * Dispatch a transactional email, SWALLOWING any delivery failure (log-only, never rethrow). This is a
     * security control, not just resilience: {@code requestSignup}/{@code requestRecovery} do observable work
     * only for an eligible email, so if a failed send propagated it would surface as a 500 for a known address
     * vs the neutral 202 for an unknown one — a status-based enumeration oracle (review council 2026-07-21).
     * Swallowing keeps the response identical on both branches; a persistent outage shows up in the logs, and
     * the user simply re-requests. (SmtpEmailSender still propagates to ITS caller; this layer is where the
     * enumeration-neutral contract is enforced.)
     */
    private void sendQuietly(String to, EmailTemplates.Message m) {
        try {
            email.send(to, m.subject(), m.body());
        } catch (RuntimeException ex) {
            log.error("[auth] failed to send a transactional email (\"{}\") — request still returns the neutral "
                    + "202; the recipient can retry. Cause: {}", m.subject(), ex.toString());
        }
    }

    /**
     * Complete a recovery: validate the two passwords, ATOMICALLY claim one RESET verify attempt (purpose-keyed,
     * so a live SIGNUP code can't satisfy it and the 5-attempt lockout can't be bypassed), check the code, then
     * ATOMICALLY set the new hash + bump tokenVersion in ONE findAndModify — reading back the NEW version and
     * minting the returned JWT at it, so this session survives while EVERY other outstanding token is revoked.
     * The code is consumed AFTER the reset commits (mutate-before-consume). Failures stay generic.
     */
    public AuthResponse verifyRecovery(String rawEmail, String code, String password, String confirmPassword) {
        if (password == null || !password.equals(confirmPassword)) {
            throw new BadRequestException("Passwords do not match");
        }
        String e = normalize(rawEmail);
        Instant now = Instant.now();
        AuthChallenge c = challenges.claimAttempt(e, Purpose.RESET, now, props.getMaxVerifyAttempts()).orElse(null);
        boolean valid = c != null
                && AuthCodes.matches(c.getCodeHash(), AuthCodes.hash(code == null ? "" : code, props.effectivePepper()));
        if (!valid) {
            throw new BadRequestException("Invalid or expired code");   // the attempt was already counted atomically
        }
        User u = users.resetPassword(e, encoder.encode(password))   // atomic $set hash + $inc tokenVersion, returnNew
                .orElseThrow(() -> new BadRequestException("Invalid or expired code"));   // stay generic
        challenges.consume(e, Purpose.RESET);   // single-use: the code can never be replayed
        return new AuthResponse(jwt.issue(u.getId(), u.getTokenVersion()), u.getId(), u.getEmail());
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
        AuthChallenge c = challenges.claimAttempt(e, Purpose.SIGNUP, now, props.getMaxVerifyAttempts()).orElse(null);
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
