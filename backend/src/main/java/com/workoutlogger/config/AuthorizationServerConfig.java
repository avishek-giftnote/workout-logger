package com.workoutlogger.config;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.workoutlogger.domain.User;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.security.oauth.OAuthKeyProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.config.annotation.web.configuration.OAuth2AuthorizationServerConfiguration;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;

/**
 * In-process OAuth 2.1 Authorization Server (Spring Authorization Server), additive to the existing
 * stateless API security ({@code SecurityConfig}). See docs/mcp-hosting.md.
 *
 * <p>Phase 1 (this file): the RS256/JWKS keypair, RFC 8414 authorization-server metadata, and a token
 * customizer that stamps the user's {@code tokenVersion} ({@code tv}) into access tokens so the ONE
 * revocation choke point ({@code JwtAuthenticationFilter}) governs OAuth-issued tokens too (gate G1). The
 * Mongo-backed authorization/consent stores and the login + consent flow land in Phase 4; until then the
 * framework's in-memory authorization/consent services are used (no token flow issues user tokens yet).
 */
@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class AuthorizationServerConfig {

    /**
     * The Authorization Server endpoints (/oauth2/authorize, /oauth2/token, /oauth2/jwks,
     * /.well-known/oauth-authorization-server, /connect/register). Highest priority, but scoped by the
     * configurer's own {@code securityMatcher} to those endpoints only, so it never touches /api or the SPA
     * — every other path falls through to {@code SecurityConfig}'s {@code @Order(2)} chain.
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public SecurityFilterChain authorizationServerSecurityFilterChain(HttpSecurity http) throws Exception {
        OAuth2AuthorizationServerConfiguration.applyDefaultSecurity(http);
        // Phase 4 wires the session-based login entry point + the branded consent page here.
        return http.build();
    }

    /** The RS256 signing key, published at /oauth2/jwks for resource servers (MCP, /api) to verify against. */
    @Bean
    public JWKSource<SecurityContext> jwkSource(@Value("${oauth.signing-jwk:}") String signingJwk, Environment env) {
        boolean prod = env.acceptsProfiles(Profiles.of("prod"));
        RSAKey rsaKey = OAuthKeyProvider.resolve(signingJwk, prod);
        return new ImmutableJWKSet<>(new JWKSet(rsaKey));
    }

    /** JwtDecoder the AS uses for its own token validation (client authentication, OIDC). */
    @Bean
    public JwtDecoder jwtDecoder(JWKSource<SecurityContext> jwkSource) {
        return OAuth2AuthorizationServerConfiguration.jwtDecoder(jwkSource);
    }

    /** Issuer identifier. Set {@code OAUTH_ISSUER} to the public HTTPS URL (RFC 8414 — clients validate it
     *  externally, so it must NOT be the private railway.internal host). Unset ⇒ derived per-request (dev). */
    @Bean
    public AuthorizationServerSettings authorizationServerSettings(@Value("${oauth.issuer:}") String issuer) {
        AuthorizationServerSettings.Builder b = AuthorizationServerSettings.builder();
        if (issuer != null && !issuer.isBlank()) {
            b.issuer(issuer);
        }
        return b.build();
    }

    /**
     * Stamp the user's current {@code tokenVersion} into access tokens as the {@code tv} claim, so a
     * password reset / account wipe (which bumps {@code tokenVersion}) revokes OAuth-issued tokens through
     * the SAME {@code JwtAuthenticationFilter} live check as first-party tokens (gate G1 — one revocation
     * truth, never two). The principal name is the user id (= {@code sub}); non-user grants resolve to no
     * user and are left unstamped.
     */
    @Bean
    public OAuth2TokenCustomizer<JwtEncodingContext> oauthTokenCustomizer(UserRepository users) {
        return context -> {
            if (OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType())) {
                String userId = context.getPrincipal().getName();
                users.findTokenVersionById(userId)
                        .map(User::getTokenVersion)
                        .ifPresent(tv -> context.getClaims().claim("tv", tv));
            }
        };
    }
}
