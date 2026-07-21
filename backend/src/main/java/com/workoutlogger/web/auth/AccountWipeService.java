package com.workoutlogger.web.auth;

import com.workoutlogger.repo.AuthChallengeRepository;
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
 * its repository; {@code authChallenges} is email-keyed (pre-user, no userId), so the caller passes the email,
 * read from the User doc BEFORE it is deleted. Token death after the wipe is the vanished User doc itself — no
 * tokenVersion bump required.
 */
@Service
public class AccountWipeService {

    private final WorkoutRepository workouts;
    private final ExerciseRepository exercises;
    private final TemplateRepository templates;
    private final SplitRepository splits;
    private final PlanRepository plans;
    private final AuthChallengeRepository challenges;
    private final UserRepository users;
    private final Tenant tenant;

    public AccountWipeService(WorkoutRepository workouts, ExerciseRepository exercises,
                              TemplateRepository templates, SplitRepository splits, PlanRepository plans,
                              AuthChallengeRepository challenges, UserRepository users, Tenant tenant) {
        this.workouts = workouts;
        this.exercises = exercises;
        this.templates = templates;
        this.splits = splits;
        this.plans = plans;
        this.challenges = challenges;
        this.users = users;
        this.tenant = tenant;
    }

    /**
     * Wipe the current tenant. {@code email} is the account's normalized email, read from the User doc by the
     * caller before this runs (needed for the email-keyed authChallenges purge). Idempotent.
     */
    public void wipeCurrentTenant(String email) {
        // 1..5 — tenant-scoped children (bare userId, includes soft-deleted rows).
        workouts.deleteAllForTenant();
        exercises.deleteAllForTenant();
        templates.deleteAllForTenant();
        splits.deleteAllForTenant();
        plans.deleteAllForTenant();
        // 6 — email-keyed pre-user rows, so no stale SIGNUP/RESET challenge survives a future re-registration.
        if (email != null) challenges.deleteAllForEmail(email);
        // 7 — the User doc LAST: the commit point that makes every outstanding token die.
        users.deleteById(tenant.userId());
    }
}
