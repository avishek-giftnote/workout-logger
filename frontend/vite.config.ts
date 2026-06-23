import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev server proxies API calls to the Spring Boot backend.
export default defineConfig({
  plugins: [react()],
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
