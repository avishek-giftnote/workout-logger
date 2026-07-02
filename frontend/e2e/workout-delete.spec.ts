import { test, expect } from "@playwright/test";
import { register, logSet } from "./helpers";

// MEDIUM — delete is server-persisted; the two-step confirm + the "gone after reload" check catches a
// stale-cache bug (deleted client-side but still on the server) invisible to ApiIntegrationTest.
test("workout delete: two-step confirm removes it, and it stays gone after reload", async ({ page }) => {
  test.slow();
  await register(page);
  await logSet(page, "Barbell Bench Press", "80", "5");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".w-item")).toHaveCount(1);

  await page.locator(".w-item").first().click();
  await page.waitForURL(/\/previous-workouts\/[a-f0-9]+$/);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  // two-step confirm popup (WorkoutDetailPage.tsx)
  await expect(page.getByRole("heading", { name: "Delete this session?" })).toBeVisible();
  await page.getByRole("button", { name: "Delete workout" }).click();

  await expect(page).toHaveURL(/\/previous-workouts$/);
  await expect(page.getByText("No sessions yet")).toBeVisible();
  await page.reload();
  await expect(page.getByText("No sessions yet")).toBeVisible();   // server-persisted delete, not a cache blip
});
