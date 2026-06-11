import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dev server proxies API calls to the Spring Boot backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  test: {
    // The combinatorial coaching EVAL lives in *.eval.test.ts and runs via `npm run eval`,
    // not the unit gate — keep it out of `npm test`.
    exclude: [...configDefaults.exclude, "**/*.eval.test.ts"],
  },
});
