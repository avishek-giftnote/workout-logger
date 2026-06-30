package com.workoutlogger.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Forwards client-side (React Router) routes to the bundled SPA's index.html so a hard refresh or
 * deep link (e.g. /start, /plan, /exercise-list, /previous-workouts) does not 404. The SPA is built
 * into src/main/resources/static/ at image-build time and served from the classpath.
 *
 * <p>Scoping — only extensionless app routes forward:
 * <ul>
 *   <li>A matched segment uses {@code [^\.]*}, which excludes any path whose last segment contains a
 *       dot. So real static assets ({@code /assets/app.js}, {@code /favicon.ico}) keep their
 *       extension and are served directly by Spring's resource handler — they never reach here.</li>
 *   <li>The API and tooling prefixes ({@code /api/**}, {@code /actuator/**}, {@code /v3/**},
 *       {@code /swagger-ui/**}) are mapped by their own controllers/handlers, which are MORE SPECIFIC
 *       (literal paths) or higher-precedence (actuator's endpoint handler mapping) than this
 *       catch-all, so they win the mapping and are never forwarded to index.html.</li>
 *   <li>The extra two- and three-segment patterns cover React Router deep links like
 *       {@code /previous-workouts/{id}} and {@code /previous-workouts/{id}/edit} so a hard refresh on
 *       a detail page resolves to the SPA shell instead of 404. (Spring Boot's PathPattern parser
 *       forbids a wildcard mid-pattern — {@code /**}{@code /{path}} is illegal — so extensionless
 *       depth is enumerated rather than using a trailing-wildcard match.)</li>
 * </ul>
 * The root {@code /} is mapped explicitly because the path-variable patterns do not match it.
 */
@Controller
public class SpaForwardController {

    /**
     * Forward the application root and any extensionless path (up to three segments — the deepest
     * client-side route is {@code /previous-workouts/{id}/edit}) to the SPA shell. {@code [^\.]*} on
     * every segment excludes paths whose last segment is a file, so static assets ({@code app.js},
     * {@code favicon.ico}) are never matched and are served by the resource handler. The more
     * specific API/tooling mappings ({@code /api/**}, {@code /v3/**}, {@code /swagger-ui/**}) and the
     * higher-precedence actuator endpoint mapping win over these catch-alls, so only genuine
     * client-side routes reach index.html.
     */
    @GetMapping(value = {
            "/",
            "/{p1:[^\\.]*}",
            "/{p1:[^\\.]*}/{p2:[^\\.]*}",
            "/{p1:[^\\.]*}/{p2:[^\\.]*}/{p3:[^\\.]*}"
    })
    public String forwardSpa() {
        return "forward:/index.html";
    }
}
