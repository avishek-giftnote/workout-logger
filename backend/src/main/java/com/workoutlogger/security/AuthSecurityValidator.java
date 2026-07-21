package com.workoutlogger.security;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Warns (loudly) when the auth pepper is unconfigured under {@code prod}. A blank {@code AUTH_TOKEN_PEPPER} makes
 * {@link AuthProperties#effectivePepper()} fall back to a source-committed dev constant, which would make every
 * sign-up {@code codeHash} = SHA-256(code + a publicly-known string) — offline-precomputable from a DB dump.
 *
 * <p>This is a WARN, not a hard fail-fast, ON PURPOSE (for now): the current prod build ships the
 * {@link com.workoutlogger.email.NoOpEmailSender} (no real email delivery), so no verification code ever reaches
 * a user and the pepper protects nothing operational yet — bricking a live deploy over it is the wrong trade-off.
 * **Restore the fail-fast (throw), mirroring {@link JwtService}'s M7 secret guard, when a real email provider is
 * wired and verified sign-up goes live in prod** — at which point {@code AUTH_TOKEN_PEPPER} must be set.
 */
@Component
public class AuthSecurityValidator {

    private static final Logger log = LoggerFactory.getLogger(AuthSecurityValidator.class);

    private final AuthProperties props;
    private final Environment env;

    public AuthSecurityValidator(AuthProperties props, Environment env) {
        this.props = props;
        this.env = env;
    }

    @PostConstruct
    void validate() {
        boolean prod = env.acceptsProfiles(Profiles.of("prod"));
        if (prod && (props.getPepper() == null || props.getPepper().isBlank())) {
            log.warn("AUTH_TOKEN_PEPPER is not set under the 'prod' profile — the sign-up code hash is using the "
                    + "insecure dev-fallback pepper. Set AUTH_TOKEN_PEPPER (a real secret) before enabling verified "
                    + "sign-up with a real email provider in prod.");
        }
    }
}
