package com.workoutlogger.security;

import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Issues the FIRST-PARTY (SPA) access token as an RS256 JWT signed by the Authorization Server's key.
 *
 * <p><b>Why RS256 and not the old HS256 service.</b> docs/mcp-hosting.md locked a "synthesized single
 * validator" token model: {@code /api} runs exactly ONE validator, and the first-party login mints through
 * the same AS key an OAuth client would. That removes the dual-accept branch (and its precedence questions)
 * rather than carrying two trust roots forever. This class is the first-party half of that; the OAuth half
 * is the AS's own token endpoint. Both produce tokens the identical filter verifies.
 *
 * <p>The key comes from the SAME {@link JWKSource} bean {@code AuthorizationServerConfig} publishes at
 * {@code /oauth2/jwks}, so there is one keypair, one JWKS, and one rotation story — never a second secret
 * to keep in sync.
 *
 * <p>Claims mirror an AS-issued token exactly, so the filter cannot tell them apart structurally:
 * {@code sub} = user id, {@code tv} = tokenVersion (the revocation choke point, gate G1), {@code aud} =
 * this API (confused-deputy binding), and {@code scope}. First-party tokens carry the FULL scope set: the
 * SPA is the user operating their own account directly, so it must not be narrower than a delegated client.
 * That also keeps the SPA working unchanged when Phase 4 puts {@code @PreAuthorize} on the destructive
 * endpoints.
 */
@Service
public class Rs256TokenIssuer {

    public static final String SCOPE_READ = "workout:read";
    public static final String SCOPE_WRITE = "workout:write";
    /** Gates the irreversible operations (delete a workout, end a plan, wipe the account). */
    public static final String SCOPE_DESTRUCTIVE = "workout:destructive";

    /** What a first-party SPA token carries — the user acting on their own account, so: everything. */
    public static final String FIRST_PARTY_SCOPES =
            SCOPE_READ + " " + SCOPE_WRITE + " " + SCOPE_DESTRUCTIVE;

    private final JwtEncoder encoder;
    private final String audience;
    private final String issuer;
    private final long expiryMinutes;

    public Rs256TokenIssuer(JWKSource<SecurityContext> jwkSource,
                            JwtProperties props,
                            @Value("${oauth.api-audience:workout-logger-api}") String audience,
                            @Value("${oauth.issuer:}") String issuer) {
        this.encoder = new NimbusJwtEncoder(jwkSource);
        this.audience = audience;
        this.issuer = issuer;
        this.expiryMinutes = props.getExpiryMinutes();
    }

    /** Issue at the user's current tokenVersion with the configured lifetime. */
    public String issue(String userId, int tokenVersion) {
        return issue(userId, tokenVersion, expiryMinutes);
    }

    /** Issue with an explicit lifetime (the seam a future remember-me would use). */
    public String issue(String userId, int tokenVersion, long expiryMins) {
        Instant now = Instant.now();
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder()
                .subject(userId)
                .audience(List.of(audience))
                .claim("tv", tokenVersion)
                .claim("scope", FIRST_PARTY_SCOPES)
                .issuedAt(now)
                .expiresAt(now.plus(expiryMins, ChronoUnit.MINUTES));
        // Only stamp `iss` when an issuer is configured. Blank in dev, where the AS derives it per-request;
        // stamping a wrong value would be worse than omitting it.
        if (issuer != null && !issuer.isBlank()) {
            claims.issuer(issuer);
        }
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).build();
        return encoder.encode(JwtEncoderParameters.from(header, claims.build())).getTokenValue();
    }
}
