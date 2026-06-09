package com.workoutlogger.web.auth;

import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.JwtService;
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

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;

    public AuthController(UserRepository users, PasswordEncoder encoder, JwtService jwt) {
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
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
        return new AuthResponse(jwt.issue(u.getId()), u.getId(), u.getEmail());
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest req) {
        String email = req.email().trim().toLowerCase(Locale.ROOT);
        User u = users.findByEmail(email)
                .filter(usr -> usr.getPasswordHash() != null
                        && encoder.matches(req.password(), usr.getPasswordHash()))
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));
        return new AuthResponse(jwt.issue(u.getId()), u.getId(), u.getEmail());
    }
}
