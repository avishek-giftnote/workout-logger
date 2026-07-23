package com.workoutlogger.web.auth;

import com.workoutlogger.domain.User;
import com.workoutlogger.importer.DefaultExerciseSeeder;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.Rs256TokenIssuer;
import com.workoutlogger.web.auth.AuthDtos.*;
import com.workoutlogger.web.error.ApiExceptions.ConflictException;
import jakarta.validation.Valid;
import org.bson.types.ObjectId;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.Locale;

/**
 * Public auth surface: trivial email + password sign-up and sign-in. {@code /register} creates the account
 * immediately (no email verification) and returns a JWT; {@code /login} authenticates. Deliberately simple —
 * the deployment target (Railway, non-Pro) blocks outbound SMTP, so email-based verification/recovery is not
 * used. Account deletion still lives at {@code POST /api/me/delete} (password-gated, no email).
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final Rs256TokenIssuer jwt;
    private final DefaultExerciseSeeder seeder;

    public AuthController(UserRepository users, PasswordEncoder encoder, Rs256TokenIssuer jwt, DefaultExerciseSeeder seeder) {
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
        this.seeder = seeder;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthResponse register(@Valid @RequestBody RegisterRequest req) {
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        if (users.existsByEmail(email)) {
            throw new ConflictException("Email already registered", null);
        }
        Instant now = Instant.now();
        User u = new User();
        u.setId(new ObjectId().toHexString());
        u.setEmail(email);
        u.setPasswordHash(encoder.encode(req.password()));
        u.setCreatedAt(now);
        u.setUpdatedAt(now);
        users.save(u);
        seeder.seed(u.getId());   // populate the default exercise catalog
        return new AuthResponse(jwt.issue(u.getId(), u.getTokenVersion()), u.getId(), u.getEmail());
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest req) {
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        User u = users.findByEmail(email)
                .filter(usr -> usr.getPasswordHash() != null
                        && encoder.matches(req.password(), usr.getPasswordHash()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));
        // Mint at the user's CURRENT tokenVersion — JwtAuthenticationFilter rejects a token whose tv doesn't
        // match the stored value, so hardcoding 0 would lock out any account with tokenVersion > 0.
        return new AuthResponse(jwt.issue(u.getId(), u.getTokenVersion()), u.getId(), u.getEmail());
    }
}
