package com.workoutlogger.security;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * The single source of the authenticated user id (DESIGN.md §3.3 isolation choke point).
 * Repositories read the tenant here and AND it into every query, so isolation is by construction —
 * callers cannot forget to scope, and the client-supplied id is never trusted for authorization.
 */
@Component
public class Tenant {

    /** @return the current user's id; throws if the request is not authenticated. */
    public String userId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || !(auth.getPrincipal() instanceof String uid)
                || uid.isBlank()) {
            throw new AccessDeniedException("No authenticated user in context");
        }
        return uid;
    }
}
