package com.workoutlogger.web.auth;

import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.JwtService;
import com.workoutlogger.web.auth.AuthDtos.*;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;

/**
 * Public auth surface. Sign-up is TWO steps — {@code /signup/request} emails a code, {@code /signup/verify}
 * consumes it and creates the account (see {@link AuthService}). There is deliberately NO {@code /register}
 * endpoint: atomic account creation would leak email-enumeration (409 "already registered") and bypass
 * verification. The {@code /signup/request} endpoint replies with an identical neutral 202 regardless of
 * whether the email already has an account.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    /** A real BCrypt hash matched against when the email is unknown, so login spends the same ~100ms of BCrypt
     *  whether or not the account exists — no timing oracle to enumerate registered emails. */
    private final String dummyHash;

    public AuthController(AuthService auth, UserRepository users, PasswordEncoder encoder, JwtService jwt) {
        this.auth = auth;
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
        this.dummyHash = encoder.encode("timing-equalizer-never-a-real-password");
    }

    /** Step 1: request a sign-up code. Always 202 (enumeration-neutral) — the body reveals nothing. */
    @PostMapping("/signup/request")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void signupRequest(@Valid @RequestBody SignupRequestRequest req) {
        auth.requestSignup(req.email());
    }

    /** Step 2: verify the code + set the password; creates the account and returns a JWT. */
    @PostMapping("/signup/verify")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse signupVerify(@Valid @RequestBody SignupVerifyRequest req) {
        return auth.verifySignup(req.email(), req.code(), req.password(), req.confirmPassword());
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest req) {
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        User u = users.findByEmail(email).orElse(null);
        // Always run BCrypt (against the real hash, or a dummy when the email is unknown) so the timing is
        // identical whether or not the account exists — closing the login enumeration channel.
        String hash = (u != null && u.getPasswordHash() != null) ? u.getPasswordHash() : dummyHash;
        boolean ok = encoder.matches(req.password(), hash) && u != null && u.getPasswordHash() != null;
        if (!ok) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials");
        }
        return new AuthResponse(jwt.issue(u.getId(), u.getTokenVersion()), u.getId(), u.getEmail());
    }
}
