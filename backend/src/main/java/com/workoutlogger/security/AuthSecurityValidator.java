package com.workoutlogger.security;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Guards the auth pepper. A blank {@code AUTH_TOKEN_PEPPER} makes {@link AuthProperties#effectivePepper()} fall
 * back to a source-committed dev constant, so every sign-up {@code codeHash} = SHA-256(code + a publicly-known
 * string) — offline-precomputable from a DB dump.
 *
 * <p>The severity is tied to whether codes are actually DELIVERED:
 * <ul>
 *   <li><b>Real delivery on</b> ({@code email.sender=smtp}) + blank pepper ⇒ <b>fail-fast</b> (throw), mirroring
 *       {@link JwtService}'s M7 secret guard — a live verified sign-up must not hash real codes with a known pepper.</li>
 *   <li><b>Prod but no real delivery</b> (NoOp sender) + blank pepper ⇒ a loud WARN only — no code reaches a user,
 *       so the pepper protects nothing operational yet, and bricking a live deploy over it is the wrong trade-off.</li>
 * </ul>
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
        boolean blankPepper = props.getPepper() == null || props.getPepper().isBlank();
        if (!blankPepper) return;
        boolean realDelivery = "smtp".equalsIgnoreCase(env.getProperty("email.sender", ""));
        if (realDelivery) {
            throw new IllegalStateException("AUTH_TOKEN_PEPPER is required when email.sender=smtp (real verified "
                    + "sign-up): refusing to hash verification codes with the publicly-known dev-fallback pepper.");
        }
        if (env.acceptsProfiles(Profiles.of("prod"))) {
            log.warn("AUTH_TOKEN_PEPPER is not set under the 'prod' profile — the sign-up code hash is using the "
                    + "insecure dev-fallback pepper. Set AUTH_TOKEN_PEPPER (a real secret) before switching "
                    + "email.sender=smtp to deliver real codes.");
        }
    }
}
