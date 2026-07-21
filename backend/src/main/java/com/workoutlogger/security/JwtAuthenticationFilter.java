package com.workoutlogger.security;

import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Authenticates requests bearing a valid {@code Authorization: Bearer <jwt>} header, setting the
 * user id as the security principal (read later by {@link Tenant}). Invalid/absent tokens simply
 * leave the context unauthenticated; the SecurityFilterChain then rejects protected endpoints.
 *
 * <p>Beyond signature verification, this is the ONE revocation choke point: the token's {@code tv} claim is
 * matched against the user's current {@code tokenVersion} (one indexed {@code _id} projection lookup per
 * authed request). A stale token (password reset / account wipe bumped the version) or a token for a
 * no-longer-existing user (wiped) is rejected — closing the "still-valid 30-day token keeps writing under a
 * dead userId" hole that pure signature trust left open. Runs once per request (OncePerRequestFilter), not
 * per repository call, so the hot Tenant.userId() path stays lookup-free.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final UserRepository users;

    public JwtAuthenticationFilter(JwtService jwtService, UserRepository users) {
        this.jwtService = jwtService;
        this.users = users;
    }

    @Override
    protected void doFilterInternal(@NonNull HttpServletRequest request,
                                    @NonNull HttpServletResponse response,
                                    @NonNull FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                JwtService.VerifiedToken vt = jwtService.verify(header.substring(7));
                // Revocation + existence check: the user must still exist and the token's version must match.
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
            } catch (Exception ignored) {
                // Invalid token -> stay unauthenticated; protected routes will 401.
            }
        }
        chain.doFilter(request, response);
    }
}
