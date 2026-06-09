package com.workoutlogger.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI document (served at /v3/api-docs, UI at /swagger-ui.html). Java is the contract
 * source of truth; the React TS client is generated from /v3/api-docs (see backend/README.md).
 */
@Configuration
public class OpenApiConfig {

    private static final String BEARER = "bearerAuth";

    @Bean
    public OpenAPI workoutLoggerOpenApi() {
        return new OpenAPI()
                .info(new Info().title("Workout Logger API").version("0.1.0")
                        .description("Strength-training log. Weights are exact decimals serialized as STRINGS."))
                .addSecurityItem(new SecurityRequirement().addList(BEARER))
                .components(new Components().addSecuritySchemes(BEARER,
                        new SecurityScheme().type(SecurityScheme.Type.HTTP)
                                .scheme("bearer").bearerFormat("JWT")));
    }
}
