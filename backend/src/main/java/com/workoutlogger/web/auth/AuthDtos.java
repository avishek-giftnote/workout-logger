package com.workoutlogger.web.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthDtos {

    private AuthDtos() {}

    /** Step 1 of sign-up: request a verification code for an email. Reply is always a neutral 202. */
    public record SignupRequestRequest(@Email @NotBlank String email) {}

    /** Step 2 of sign-up: the emailed code + a password entered twice. Creates the account on success. */
    public record SignupVerifyRequest(
            @Email @NotBlank String email,
            @NotBlank String code,
            @NotBlank @Size(min = 8, max = 100) String password,
            @NotBlank String confirmPassword) {}

    public record LoginRequest(
            @Email @NotBlank String email,
            @NotBlank String password) {}

    public record AuthResponse(String token, String userId, String email) {}
}
