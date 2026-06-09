package com.workoutlogger.web.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthDtos {

    private AuthDtos() {}

    public record RegisterRequest(
            @Email @NotBlank String email,
            @NotBlank @Size(min = 8, max = 100) String password) {}

    public record LoginRequest(
            @Email @NotBlank String email,
            @NotBlank String password) {}

    public record AuthResponse(String token, String userId, String email) {}
}
