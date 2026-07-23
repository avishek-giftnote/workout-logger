package com.workoutlogger.config;

import com.workoutlogger.security.JwtAuthenticationFilter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SecurityConfig {

    // Explicitly-public API + tooling paths. Everything that is NOT under /api is public too (the
    // bundled SPA shell, static assets, and forwarded client-side routes) — see the matcher rules below.
    private static final String[] PUBLIC = {
            "/api/auth/**", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html", "/actuator/health"
    };

    // @Order(2): the default chain. The OAuth Authorization Server chain (AuthorizationServerConfig,
    // HIGHEST_PRECEDENCE) is scoped by its own securityMatcher to the /oauth2/** + metadata endpoints and
    // runs first; every other path (the /api surface + the SPA) falls through to this unchanged chain.
    @Bean
    @Order(2)
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthenticationFilter jwtFilter)
            throws Exception {
        AuthenticationEntryPoint unauthorized =
                (req, res, ex) -> res.sendError(HttpStatus.UNAUTHORIZED.value(), "Unauthorized");
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(c -> {})
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(reg -> reg
                        // Explicitly-public API + tooling paths (auth, OpenAPI/Swagger, health probe).
                        .requestMatchers(PUBLIC).permitAll()
                        // The rest of the API surface requires a valid JWT (tenant-scoped).
                        .requestMatchers("/api/**").authenticated()
                        // Everything else is the bundled SPA: index.html, static assets, and the
                        // extensionless client-side routes the SpaForwardController forwards. Public.
                        .anyRequest().permitAll())
                .exceptionHandling(e -> e.authenticationEntryPoint(unauthorized))
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
