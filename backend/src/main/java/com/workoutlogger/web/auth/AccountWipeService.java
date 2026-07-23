package com.workoutlogger.web.auth;

import com.workoutlogger.repo.ExerciseRepository;
import com.workoutlogger.repo.PlanRepository;
import com.workoutlogger.repo.SplitRepository;
import com.workoutlogger.repo.TemplateRepository;
import com.workoutlogger.repo.UserRepository;
import com.workoutlogger.repo.WorkoutRepository;
import com.workoutlogger.security.Tenant;
import org.springframework.stereotype.Service;

/**
 * Permanently deletes the current tenant's account and ALL their data (the "Confirm Account Wipe" flow).
 *
 * <p><b>Ordering is load-bearing: children first, the User doc LAST.</b> Standalone MongoDB gives no
 * multi-document transaction, so the cascade is a sequence of independent atomic {@code deleteMany}s. While
 * the User doc still exists, the JWT keeps authenticating ({@link com.workoutlogger.security.JwtAuthenticationFilter}
 * finds a live tokenVersion) and {@link Tenant#userId()} resolves — so a crash mid-cascade leaves the account
 * still loginable and the client can idempotently RE-POST the wipe. Delete the User doc first and a crash
 * strands orphaned tenant PII behind an instantly-dead token (every request 401s, the account can't finish the
 * wipe) — an unrecoverable privacy leak. Deleting the User doc is therefore the commit point.
 *
 * <p>Each step is a naturally idempotent {@code deleteMany} (a re-run deletes zero), so the whole sequence is
 * crash/retry-safe — no saga or two-phase protocol is needed. Every collection delete is tenant-scoped through
 * its repository. Token death after the wipe is the vanished User doc itself — the per-request
 * {@code findTokenVersionById} returns empty, so any outstanding token 401s; no tokenVersion bump required.
 */
@Service
public class AccountWipeService {

    private final WorkoutRepository workouts;
    private final ExerciseRepository exercises;
    private final TemplateRepository templates;
    private final SplitRepository splits;
    private final PlanRepository plans;
    private final UserRepository users;
    private final Tenant tenant;

    public AccountWipeService(WorkoutRepository workouts, ExerciseRepository exercises,
                              TemplateRepository templates, SplitRepository splits, PlanRepository plans,
                              UserRepository users, Tenant tenant) {
        this.workouts = workouts;
        this.exercises = exercises;
        this.templates = templates;
        this.splits = splits;
        this.plans = plans;
        this.users = users;
        this.tenant = tenant;
    }

    /** Wipe the current tenant: every child collection first, then the User doc LAST (the commit point that
     *  makes every outstanding token die). Idempotent. */
    public void wipeCurrentTenant() {
        // 1..5 — tenant-scoped children (bare userId, includes soft-deleted rows).
        workouts.deleteAllForTenant();
        exercises.deleteAllForTenant();
        templates.deleteAllForTenant();
        splits.deleteAllForTenant();
        plans.deleteAllForTenant();
        // 6 — the User doc LAST: the commit point that makes every outstanding token die.
        users.deleteById(tenant.userId());
    }
}
