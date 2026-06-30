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
RUN npm run build

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
# Container health = the actuator probe. Docker/compose restarts the container if this fails;
# with the Cloudflare Tunnel, an unhealthy app means cloudflared has nothing to route to.
HEALTHCHECK --interval=15s --timeout=3s --start-period=45s --retries=3 \
    CMD curl -fsS http://localhost:8080/actuator/health || exit 1
# MaxRAMPercentage 75% — on an Ampere A1 VM (e.g. 6–24 GB) this gives the JVM a multi-GB heap;
# override with -e JAVA_OPTS / JAVA_TOOL_OPTIONS if you pin a smaller machine shape.
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
