import { test, expect } from "@playwright/test";
import { register, logSet } from "./helpers";

// P0 — tenant isolation is "the entire security story" (CLAUDE.md / DESIGN.md §2a): every repo ANDs
// userId, and ApiIntegrationTest proves user B gets 404 on user A's data at the API layer. This is the
// UI-layer mirror: proves the CLIENT never renders another tenant's data — the meaningfully-stronger
// assertion (the server 404 is already covered; what's untested is that the client interprets it safely).
test("tenant isolation: user B never sees user A's workouts, catalog, or a direct-linked session", async ({ browser }) => {
  test.slow();   // two accounts + a logged workout over remote Atlas — well past the 30s default budget
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // A logs a workout with a distinctive weight (default exercise → reliable path) and we capture the URL.
  await register(a);
  await logSet(a, "Barbell Bench Press", "123.5", "5");
  await a.getByRole("button", { name: "List", exact: true }).click();
  await a.locator(".w-item").first().click();
  await a.waitForURL(/\/previous-workouts\/[a-f0-9]+$/);
  const aWorkoutPath = new URL(a.url()).pathname;

  // B is a fresh, separate tenant.
  await register(b);

  // 1. B's training log is empty — none of A's data bleeds in.
  await b.goto("/previous-workouts");
  await expect(b.getByText("No sessions yet")).toBeVisible();

  // 2. B's catalog is exactly the seeded defaults (84) — tenant-scoped, unaffected by A. Exact match:
  //    a substring "84 exercises" would also pass on "184 exercises", defeating the count contract.
  await b.getByRole("button", { name: "Exercises" }).click();
  await expect(b.getByText("84 exercises", { exact: true })).toBeVisible();

  // 3. B deep-linking directly to A's workout must NOT render A's data — the security invariant — and the
  //    page must SETTLE (no spinner-forever). Both are hard-asserted here.
  await b.goto(aWorkoutPath);
  await expect(b.getByText("123.5")).toHaveCount(0);               // A's set weight never shows
  await expect(b.locator(".set-row")).toHaveCount(0);
  await expect(b.getByText("Couldn't load data")).toBeVisible();   // pins CURRENT behaviour (see the F01 fixme)

  await ctxA.close();
  await ctxB.close();
});

// F01 (docs/e2e-findings.md): the INTENDED state for a tenant-scoped/nonexistent workout is a "not found"
// message, not the generic connectivity error. WorkoutDetailPage even has a dead "Workout not found" branch.
// This fails today (getWorkout doesn't coerce 404 → QueryError wins); kept as a fails-loud fixme so a fix
// flips it green and prompts removing the fixme, rather than a permissive OR that hides the discrepancy.
test.fixme("F01: a nonexistent/foreign workout shows a not-found state, not a generic connection error", async ({ page }) => {
  await register(page);
  await page.goto("/previous-workouts/000000000000000000000000");
  await expect(page.getByText("Workout not found")).toBeVisible();
});
