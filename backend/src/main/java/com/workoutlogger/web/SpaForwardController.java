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
 *   <li>The API and tooling prefixes ({@code /api}, {@code /actuator}, {@code /v3}, {@code /swagger-ui})
 *       are excluded from the FIRST segment by a negative lookahead. A mapped route (e.g.
 *       {@code /api/workouts/{id}}) would win on specificity anyway, but an UNMAPPED one would not:
 *       before the lookahead, an authenticated {@code GET /api/nope} fell into this catch-all and got the
 *       SPA shell as {@code 200 text/html} instead of a 404 JSON, so a typo'd or removed endpoint looked
 *       like a success and any JSON client choked parsing HTML. Excluded paths now fall through to the
 *       resource handler → {@code NoResourceFoundException} → the 404 in {@code ApiExceptionHandler}.</li>
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

    /** Any segment: extensionless, so real static assets (app.js, favicon.ico) are never matched. */
    private static final String SEG = "[^\\.]*";

    /**
     * First segment: extensionless AND not a reserved backend prefix. The lookahead is what stops an
     * UNMAPPED {@code /api/...} route from being swallowed by this catch-all and answered with the SPA
     * shell; those now fall through to a real 404.
     */
    private static final String FIRST_SEG = "(?!(?:api|actuator|v3|swagger-ui)$)[^\\.]*";

    /**
     * Forward the application root and any extensionless, non-reserved path (up to three segments — the
     * deepest client-side route is {@code /previous-workouts/{id}/edit}) to the SPA shell.
     */
    @GetMapping(value = {
            "/",
            "/{p1:" + FIRST_SEG + "}",
            "/{p1:" + FIRST_SEG + "}/{p2:" + SEG + "}",
            "/{p1:" + FIRST_SEG + "}/{p2:" + SEG + "}/{p3:" + SEG + "}"
    })
    public String forwardSpa() {
        return "forward:/index.html";
    }
}
