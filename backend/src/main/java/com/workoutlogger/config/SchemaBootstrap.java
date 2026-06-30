package com.workoutlogger.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Ensures the DESIGN §2 collections + indexes exist on <em>every</em> normal server start — most
 * importantly the unique {@code users.email} index and the partial-unique one-ACTIVE-plan-per-user index.
 * Those are the only DB-level guard against the register / createPlan races (MongoDB has no RLS, and these
 * write paths are check-then-act with no transaction).
 *
 * <p>Previously {@link MongoSchemaInitializer#initialize()} ran ONLY in the one-time {@code import} profile
 * (via {@code ImportRunner}), so a normally-booted server had no unique email constraint and concurrent
 * {@code POST /api/auth/register} for the same email both passed {@code existsByEmail} and both saved →
 * duplicate accounts, which then made {@code findByEmail} throw {@code IncorrectResultSize} → login 500.
 *
 * <p>Web-only ({@code @ConditionalOnWebApplication}): the import CLI is non-web and runs the initializer
 * itself, so this never double-fires there. Idempotent — {@code createIndex} is a no-op when the index
 * already exists. Fail-fast by design: if the live DB already contains duplicate emails (or a colliding
 * unique key), the index build throws and the server refuses to start — dedupe before deploying rather than
 * boot silently unprotected.
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class SchemaBootstrap {

    private final MongoSchemaInitializer initializer;

    public SchemaBootstrap(MongoSchemaInitializer initializer) {
        this.initializer = initializer;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureSchema() {
        initializer.initialize();
    }
}
