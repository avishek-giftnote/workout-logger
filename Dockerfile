# syntax=docker/dockerfile:1
# Multi-stage build: bundle the Vite SPA into the Spring Boot jar and ship a single image.
# The SPA is copied into backend/src/main/resources/static at build time (NOT committed to git),
# so the backend serves both the API (/api) and the static frontend from one origin on :8080.

# ── Stage 1: build the frontend (Vite default output: /app/frontend/dist) ─────
FROM node:22-slim AS frontend
WORKDIR /app/frontend
# Install deps from the lockfile first so this layer caches when only source changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Sentry build inputs (all optional — absent ⇒ Sentry stays off / no source-map upload):
#   VITE_SENTRY_DSN     — baked into the bundle so error monitoring runs in prod (public value)
#   VITE_SENTRY_RELEASE — release tag (pass the git SHA) so events + maps group per deploy
#   SENTRY_ORG/PROJECT  — slugs for source-map upload (not secret)
#   SENTRY_AUTH_TOKEN   — enables source-map upload. When present, @sentry/vite-plugin uploads the maps and
#                         DELETES the .map files so they never ship inside the jar; absent ⇒ upload skipped.
#
# The token is a plain ARG, NOT a BuildKit `--mount=type=secret`: Railway's builder only supports
# `--mount=type=cache` and rejects secret mounts at Dockerfile parse. Caveat: a build ARG is recorded in
# `docker history`, so keep this image private and use a short-lived token scoped to `project:releases`.
ARG VITE_SENTRY_DSN=
ARG VITE_SENTRY_RELEASE=
ARG SENTRY_ORG=
ARG SENTRY_PROJECT=
ARG SENTRY_AUTH_TOKEN=
# Railway injects RAILWAY_GIT_COMMIT_SHA on a GitHub-triggered deploy. Declaring it as an ARG lets the builder
# pass it through, so the Sentry release defaults to the deployed commit and errors group per deploy with no
# manual bookkeeping. (A Railway *variable reference* — ${{RAILWAY_GIT_COMMIT_SHA}} — does NOT work: it resolves
# against the service's configured variables, where no RAILWAY_GIT_* exists, and silently stores "".)
# `:-` treats an empty value as unset, so an explicit VITE_SENTRY_RELEASE still wins; blank off-Railway.
ARG RAILWAY_GIT_COMMIT_SHA=
RUN VITE_SENTRY_DSN="$VITE_SENTRY_DSN" \
    VITE_SENTRY_RELEASE="${VITE_SENTRY_RELEASE:-$RAILWAY_GIT_COMMIT_SHA}" \
    SENTRY_ORG="$SENTRY_ORG" SENTRY_PROJECT="$SENTRY_PROJECT" \
    SENTRY_AUTH_TOKEN="$SENTRY_AUTH_TOKEN" \
    npm run build

# ── Stage 2: build the backend jar with the SPA bundled into static/ ──────────
FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /app
# Resolve Maven deps first (cached unless pom.xml changes).
COPY backend/pom.xml ./pom.xml
RUN mvn -B -q dependency:go-offline
COPY backend/ ./
# THE BUNDLING STEP: drop the real built SPA into the resources so it lands in the jar.
COPY --from=frontend /app/frontend/dist ./src/main/resources/static
RUN mvn -B -DskipTests package

# ── Stage 3: minimal runtime ──────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-jammy AS runtime
WORKDIR /app
# curl only for the container HEALTHCHECK (the jre image ships without it).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
# Single fat jar from the package stage (finalName is artifactId-version).
COPY --from=backend /app/target/*.jar /app/app.jar
EXPOSE 8080
# Container health = the actuator probe, for any runtime that honours a Docker HEALTHCHECK.
# NOTE: Railway does not use this (it runs its own healthcheck against the service URL), and this line
# hardcodes 8080 while the app binds $PORT — so on Railway it is inert. Kept as generic container
# metadata; see DEPLOY.md if you ever want it removed.
HEALTHCHECK --interval=15s --timeout=3s --start-period=45s --retries=3 \
    CMD curl -fsS http://localhost:8080/actuator/health || exit 1
# MaxRAMPercentage 75% — let the JVM size its heap from the container's memory limit rather than a
# fixed -Xmx; override with -e JAVA_OPTS / JAVA_TOOL_OPTIONS to pin it.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
