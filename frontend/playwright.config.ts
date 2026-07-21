import { defineConfig, devices } from "@playwright/test";

// Local fast iteration: set E2E_BASE_URL (e.g. http://localhost:5173) to run against an ALREADY-running
// stack and skip the managed servers. Otherwise (CI / clean local run) Playwright boots the prod frontend
// bundle (`vite preview` :4173) + the packaged backend jar (:8080); Mongo must be reachable via MONGODB_URI.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
const managed = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  // Drop the run's DB on finish (remote/Atlas only) so local e2e runs stop leaking test databases.
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 1 retry everywhere: CI absorbs the odd hiccup; locally it absorbs remote-Atlas latency flake on the
  // workout-logging /start gate (~600ms/op RTT). A real failure still fails both attempts — retries mask
  // network flake, not bugs. For a fast local run, point MONGODB_URI at a local mongo instead of Atlas.
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: managed
    ? [
        {
          command: "sh -c 'java -jar ../backend/target/workout-logger-backend-*.jar'",
          url: "http://localhost:8080/v3/api-docs",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://localhost:27017/workoutlogger_e2e",
            // blank JWT secret → the backend mints an ephemeral key; fine for a single E2E run (the
            // backend stays up throughout, so tokens stay valid). Override via env if you need stability.
            SECURITY_JWT_SECRET: process.env.SECURITY_JWT_SECRET ?? "",   // pragma: allowlist secret
            // The auth rate limiter keys by IP; a whole suite of registrations comes from one host, which
            // trips it and 429s later registers (exactly why ApiIntegrationTest disables it). Off for E2E.
            SECURITY_RATELIMIT_ENABLED: "false",
            // Verified sign-up emails the code; the FileEmailSender writes it to target/email-outbox/<email>.txt
            // (this process's cwd = frontend/), which the register() helper reads. Double-gated: non-prod + this flag.
            EMAIL_SENDER: "file",
          },
        },
        {
          command: "npm run build && npm run preview -- --port 4173 --strictPort",
          url: "http://localhost:4173",
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ]
    : undefined,
});
