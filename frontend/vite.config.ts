import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Node's `process` exists when Vite runs this config; declared locally so `tsc` accepts it without pulling
// @types/node into the app's global scope (which would change setTimeout's return type, etc.).
declare const process: { env: Record<string, string | undefined> };

// Sentry source-map upload runs ONLY when SENTRY_AUTH_TOKEN is set (release builds / CI with the secret).
// A plain build (dev, or CI without the token) skips it entirely — no maps generated, no upload, build
// unaffected. Keeps the CI gate green until source maps are wired in Stage C.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;   // pragma: allowlist secret (env var reference, not a literal)

// Dev server proxies API calls to the Spring Boot backend.
export default defineConfig({
  build: { sourcemap: sentryAuthToken ? "hidden" : false },
  plugins: [
    react(),
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: sentryAuthToken,   // pragma: allowlist secret (env var reference, not a literal)
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  // sqlite-wasm ships its own worker + .wasm; don't let Vite pre-bundle it.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  // `vite preview` (used by the E2E gate to serve the prod bundle) needs its own proxy — the `server`
  // one above only applies to the dev server.
  preview: {
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  test: {
    // The combinatorial coaching EVAL lives in *.eval.test.ts and runs via `npm run eval`, not the unit
    // gate. The Playwright E2E (`e2e/*.spec.ts`) runs via `npm run e2e` — exclude both from `npm test`
    // (Vitest's default glob would otherwise try to collect the .spec.ts and fail on Playwright's API).
    exclude: [...configDefaults.exclude, "**/*.eval.test.ts", "e2e/**"],
  },
});
