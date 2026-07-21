package com.workoutlogger.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workoutlogger.security.RateLimitFilter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

/**
 * Registers the {@link RateLimitFilter} scoped to {@code /api/auth/*} and {@code /api/me/delete}, ordered
 * HIGHEST_PRECEDENCE so it runs before the Spring Security filter chain and sheds abusive load early, before
 * any BCrypt work. The Servlet {@code /api/auth/*} pattern matches the WHOLE subtree at any depth (login,
 * signup/request, signup/verify, recover/request, recover/verify, …), not just a single segment — a per-email
 * cap in AuthService backstops distributed abuse the per-IP limiter can't see. {@code /api/me/delete} is
 * capped too because it BCrypt-checks the current password, so an attacker with a stolen token could otherwise
 * use it as a password-guessing oracle (auth council 2026-07-21).
 */
@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class RateLimitConfig {

    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(
            RateLimitProperties props, ObjectMapper json) {
        FilterRegistrationBean<RateLimitFilter> reg =
                new FilterRegistrationBean<>(new RateLimitFilter(props, json));
        reg.addUrlPatterns("/api/auth/*", "/api/me/delete");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
        reg.setName("rateLimitFilter");
        return reg;
    }
}
