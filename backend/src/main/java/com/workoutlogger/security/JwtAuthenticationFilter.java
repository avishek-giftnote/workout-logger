package com.workoutlogger.security;

import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Optional;

/**
 * Authenticates requests bearing a valid {@code Authorization: Bearer <jwt>} header, setting the
 * user id as the security principal (read later by {@link Tenant}). Invalid/absent tokens simply
 * leave the context unauthenticated; the SecurityFilterChain then rejects protected endpoints.
 *
 * <p><b>Dual-decode (migration state, docs/mcp-hosting.md Phase 2).</b> Two token shapes resolve to the
 * same principal + the same revocation check:
 * <ul>
 *   <li><b>HS256</b> — the first-party SPA token minted by {@link JwtService} (no audience; trusted origin).</li>
 *   <li><b>RS256</b> — an Authorization-Server token (OAuth / MCP), verified against the AS JWKS. It MUST
 *       carry an {@code aud} naming this API ({@code oauth.api-audience}); a token minted for another
 *       resource is rejected here (the confused-deputy close), never trusted just because its signature is
 *       valid.</li>
 * </ul>
 * The algorithms use disjoint keys, so a token validates under exactly one path — no precedence ambiguity.
 * Phase 3 flips {@code JwtService} issuance to RS256 and retires the HS256 branch, collapsing this to the
 * single RS256 validator the design settled on.
 *
 * <p>Beyond signature verification, this is the ONE revocation choke point for BOTH shapes: the token's
 * {@code tv} claim is matched against the user's current {@code tokenVersion} (one indexed {@code _id}
 * projection lookup per authed request). A stale token (password reset / wipe bumped the version) or a token
 * for a wiped user is rejected — gate G1: OAuth-issued tokens are revoked through the identical check, never
 * a second mechanism. Runs once per request, so the hot {@link Tenant#userId()} path stays lookup-free.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final UserRepository users;
    private final JwtDecoder oauthJwtDecoder;   // RS256, backed by the AS JWKS
    private final String apiAudience;

    public JwtAuthenticationFilter(JwtService jwtService, UserRepository users,
                                   JwtDecoder oauthJwtDecoder,
                                   @Value("${oauth.api-audience:workout-logger-api}") String apiAudience) {
        this.jwtService = jwtService;
        this.users = users;
        this.oauthJwtDecoder = oauthJwtDecoder;
        this.apiAudience = apiAudience;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            String token = header.substring(7); // pragma: allowlist secret
            // HS256 (first-party SPA) first; fall through to RS256 (Authorization Server). Disjoint keys, so
            // at most one succeeds.
            Optional<JwtService.VerifiedToken> verified = verifyHs256(token).or(() -> verifyRs256(token));
            verified.ifPresent(vt -> {
                // Revocation + existence check (gate G1): the user must still exist and the token's version
                // must match — applied identically to HS256 and RS256 tokens.
                boolean live = users.findTokenVersionById(vt.userId())
                        .map(User::getTokenVersion)
                        .filter(current -> current == vt.tokenVersion())
                        .isPresent();
                if (live) {
                    var auth = new UsernamePasswordAuthenticationToken(
                            vt.userId(), null, AuthorityUtils.createAuthorityList("ROLE_USER"));
                    auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
                // stale/revoked/wiped -> stay unauthenticated; protected routes will 401.
            });
        }
        chain.doFilter(request, response);
    }

    private Optional<JwtService.VerifiedToken> verifyHs256(String token) {
        try {
            return Optional.of(jwtService.verify(token));
        } catch (Exception e) {
            return Optional.empty();   // not a valid HS256 token; try RS256
        }
    }

    private Optional<JwtService.VerifiedToken> verifyRs256(String token) {
        try {
            Jwt jwt = oauthJwtDecoder.decode(token);   // signature + exp/nbf via the AS JWKS
            // Confused-deputy close: an AS token must be intended for THIS resource, not merely well-signed.
            if (!jwt.getAudience().contains(apiAudience)) {
                return Optional.empty();
            }
            Object tv = jwt.getClaims().get("tv");
            int tokenVersion = (tv instanceof Number n) ? n.intValue() : 0;
            return Optional.of(new JwtService.VerifiedToken(jwt.getSubject(), tokenVersion));
        } catch (Exception e) {
            return Optional.empty();   // not a valid RS256 token
        }
    }
}
