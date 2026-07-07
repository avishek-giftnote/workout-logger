import { test, expect } from "@playwright/test";
import { register, logCardio } from "./helpers";

// The primary cardio gap this feature closed: a logged run was invisible in the SESSION history view
// (WorkoutDetailPage rendered it as "— kg / — reps / —"). Now it shows distance · duration · derived pace,
// and a distance stat tile (no kg-volume for a cardio-only session).
test("cardio session renders distance/duration/pace in history, not blank strength rows", async ({ page }) => {
  test.slow();
  await register(page);
  await logCardio(page, "Outdoor Run", "5.2", "26:14");   // a seeded CARDIO exercise (DISTANCE/DURATION/PACE)

  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.locator(".w-item").first().click();
  await page.waitForURL(/\/previous-workouts\/[a-f0-9]+$/);

  // 5.2 km in 26:14 (1574 s) → pace 5:03 /km. The canonical per-set label renders it.
  await expect(page.getByText("5.20 km · 26:14 · 5:03 /km")).toBeVisible();
  // reps/rpe columns are suppressed for a cardio set (they'd read "— reps / —" noise)
  await expect(page.locator(".detail-reps")).toHaveCount(0);
  // session summary shows a distance tile, not a kg-volume tile (cardio-only)
  await expect(page.locator(".w-stat", { hasText: "distance" })).toBeVisible();
  await expect(page.locator(".w-stat", { hasText: "kg volume" })).toHaveCount(0);
});
