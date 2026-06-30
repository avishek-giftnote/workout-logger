package com.workoutlogger.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workoutlogger.security.RateLimitFilter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;

/**
 * Registers the {@link RateLimitFilter} scoped to {@code /api/auth/*} (login + register — a single path
 * segment after {@code /api/auth}) and ordered HIGHEST_PRECEDENCE so it runs before the Spring Security
 * filter chain and sheds abusive load early, before any BCrypt work.
 */
@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class RateLimitConfig {

    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(
            RateLimitProperties props, ObjectMapper json) {
        FilterRegistrationBean<RateLimitFilter> reg =
                new FilterRegistrationBean<>(new RateLimitFilter(props, json));
        reg.addUrlPatterns("/api/auth/*");
        reg.setOrder(Ordered.HIGHEST_PRECEDENCE);
        reg.setName("rateLimitFilter");
        return reg;
    }
}
