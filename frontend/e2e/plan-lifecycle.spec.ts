import { test, expect } from "@playwright/test";
import { register } from "./helpers";

// HIGH — the plan state machine (DESIGN.md: ACTIVE | COMPLETED | ENDED; one ACTIVE plan; history
// newest-first). The ENDED fast path is the required, deterministic walk; the full COMPLETED walk is a
// documented stretch (see the fixme).
test("plan lifecycle: accept -> active -> End plan reverts to the builder and lands in history as 'Ended early'", async ({ page }) => {
  test.slow();
  await register(page);
  await page.goto("/plan");
  await expect(page.getByRole("heading", { name: "Plan a macrocycle" })).toBeVisible();

  // default builder (Build muscle / 6mo / 4 days) → accept
  await page.getByRole("button", { name: "Accept & start" }).click();
  // active view signal (plan-slots.spec uses the same): the advance control appears
  await expect(page.getByRole("button", { name: "Complete week →" })).toBeVisible();

  // End plan → two-step confirm
  await page.getByRole("button", { name: "End plan" }).click();
  await expect(page.getByText("End this plan? It's saved to your history.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();

  // reverts to the builder (no ACTIVE plan)
  await expect(page.getByRole("heading", { name: "Plan a macrocycle" })).toBeVisible();

  // shows in history with the STATUS TAG "Ended early", not "Completed" (scope to .tag — a bare
  // getByText("Completed") also matches the "N completed plan" header via case-insensitive substring).
  await page.getByRole("button", { name: "Past plans" }).click();
  await expect(page.locator("section.ex-block .tag", { hasText: "Ended early" })).toBeVisible();
  await expect(page.locator("section.ex-block .tag", { hasText: /^Completed$/ })).toHaveCount(0);
});

// Full ACTIVE -> COMPLETED walk. The council found the shortest UI-selectable route is Contest prep with a
// ~1-2 week target date (2 advances), but driving the contest-prep builder (focus-muscle multi-select +
// the date input) needs live selector confirmation; pinned as a stretch gap rather than shipped flaky.
test.fixme("plan lifecycle: contest-prep near-date plan completes in 2 advances and shows CompletionScreen once", async () => {
  // TODO: goal "Contest prep", pick a focus muscle, set targetDate ~10 days out, Accept & start; then
  // advance twice (Complete week -> Confirm, then Finish plan -> Confirm); assert "✦ PLAN COMPLETE", and
  // that reloading /plan does NOT re-show it (dismissedCompletionPlanId); /past-plans shows "Completed".
});
