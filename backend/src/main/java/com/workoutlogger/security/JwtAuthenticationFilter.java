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

/**
 * Authenticates requests bearing a valid {@code Authorization: Bearer <jwt>} header, setting the
 * user id as the security principal (read later by {@link Tenant}). Invalid/absent tokens simply
 * leave the context unauthenticated; the SecurityFilterChain then rejects protected endpoints.
 *
 * <p><b>One validator (docs/mcp-hosting.md Phase 3, the locked token model).</b> Every token reaching
 * {@code /api} is RS256, verified against the Authorization Server's JWKS — whether it was minted by the
 * first-party login ({@link Rs256TokenIssuer}) or by the AS's token endpoint for a delegated OAuth client.
 * There is no second algorithm, no second key, and therefore no precedence question about which branch wins.
 * The Phase-2 HS256 branch was the migration scaffold and is gone.
 *
 * <p>Two checks beyond the signature, both applied to every token without exception:
 * <ul>
 *   <li><b>Audience.</b> The token must name THIS API in {@code aud}. A token minted for another resource is
 *       rejected even though it is perfectly well-signed by the same AS — the confused-deputy close.</li>
 *   <li><b>Liveness (gate G1).</b> The {@code tv} claim must equal the user's current {@code tokenVersion},
 *       via one indexed {@code _id} projection lookup. A token whose version was bumped, or one for a user
 *       who no longer exists (wiped), is rejected. This is the ONE revocation choke point: it governs
 *       first-party and OAuth tokens identically, so there is never a second revocation truth to keep in
 *       sync.</li>
 * </ul>
 * Runs once per request (OncePerRequestFilter), not per repository call, so the hot {@link Tenant#userId()}
 * path stays lookup-free.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final UserRepository users;
    private final JwtDecoder jwtDecoder;   // RS256, backed by the AS JWKS
    private final String apiAudience;

    public JwtAuthenticationFilter(UserRepository users,
                                   JwtDecoder jwtDecoder,
                                   @Value("${oauth.api-audience:workout-logger-api}") String apiAudience) {
        this.users = users;
        this.jwtDecoder = jwtDecoder;
        this.apiAudience = apiAudience;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request, @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            authenticate(request, header.substring(7)); // pragma: allowlist secret
        }
        chain.doFilter(request, response);
    }

    /** Verify, audience-check, liveness-check. Any failure leaves the context unauthenticated (-> 401). */
    private void authenticate(HttpServletRequest request, String token) {
        try {
            Jwt jwt = jwtDecoder.decode(token);   // signature + exp/nbf via the AS JWKS

            if (!jwt.getAudience().contains(apiAudience)) {
                return;   // minted for a different resource; not ours to trust
            }

            String userId = jwt.getSubject();
            Object tvClaim = jwt.getClaims().get("tv");
            int tokenVersion = (tvClaim instanceof Number n) ? n.intValue() : 0;

            boolean live = users.findTokenVersionById(userId)
                    .map(User::getTokenVersion)
                    .filter(current -> current == tokenVersion)
                    .isPresent();
            if (!live) {
                return;   // stale/revoked/wiped
            }

            var auth = new UsernamePasswordAuthenticationToken(
                    userId, null, AuthorityUtils.NO_AUTHORITIES);
            auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
            SecurityContextHolder.getContext().setAuthentication(auth);
        } catch (Exception ignored) {
            // Invalid token -> stay unauthenticated; protected routes will 401.
        }
    }
}
