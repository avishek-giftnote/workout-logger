import { defineConfig } from "vitest/config";

// Dedicated config for the coaching EVAL harness (`npm run eval`). The default `npm test` gate
// excludes *.eval.test.ts (see vite.config.ts); this config runs ONLY those.
export default defineConfig({
  test: {
    include: ["src/**/*.eval.test.ts"],
    // An eval's value is its scorecard — print it even when the run passes (vitest hides
    // console output on green tests by default).
    disableConsoleIntercept: true,
  },
});
