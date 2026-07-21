package com.workoutlogger.security;

import jakarta.annotation.PostConstruct;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Fail-fast on an unconfigured auth pepper under {@code prod} — mirrors {@link JwtService}'s M7 secret guard.
 * A blank {@code AUTH_TOKEN_PEPPER} makes {@link AuthProperties#effectivePepper()} fall back to a source-committed
 * dev constant, which would make every sign-up {@code codeHash} = SHA-256(code + a publicly-known string) and
 * hand an attacker with any DB read the whole 10⁶ code space offline — voiding the pepper's only purpose. Refuse
 * to start instead. Outside prod the dev fallback is kept so the app runs without configuration.
 */
@Component
public class AuthSecurityValidator {

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
            throw new IllegalStateException("AUTH_TOKEN_PEPPER is required under the 'prod' profile "
                    + "(the sign-up code hash pepper); refusing to start with the dev fallback pepper.");
        }
    }
}
