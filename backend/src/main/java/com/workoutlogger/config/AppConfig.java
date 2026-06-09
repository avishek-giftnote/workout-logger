package com.workoutlogger.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Non-web beans available in every profile (including the non-web "import" profile).
 * The PasswordEncoder lives here, not in SecurityConfig, so the importer can hash the
 * account password when it loads history into a real, loginable user.
 */
@Configuration
public class AppConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
