import { test, expect } from "@playwright/test";
import { register, logSet } from "./helpers";

// HIGH — exercise attributes are user-editable and drive the coaching engine; the Compound/Isolation
// mechanic gate is a CLIENT-derived rule with no backend equivalent (ExerciseDetailPage.tsx cycleMuscle +
// the disabled-Compound guard), so it's only truly verified end to end here.
test("exercise catalog: attribute edits persist and the Compound mechanic gate enforces 2+ muscles", async ({ page }) => {
  test.slow();   // logs a set (create-new exercise) over remote Atlas
  await register(page);
  const name = `ZzCat ${Date.now().toString(36)}`;
  await logSet(page, name, "20", "8");   // creates a custom exercise (0 muscles, default equipment)

  await page.getByRole("button", { name: "Exercises" }).click();
  await page.getByRole("heading", { name }).click();
  await expect(page).toHaveURL(/\/exercise-list\/[a-f0-9]+$/);

  // 0 muscles → Compound is disabled with the exact gate title + helper copy (ExerciseDetailPage.tsx:175-180)
  const compound = page.getByRole("button", { name: "Compound" });
  await expect(compound).toBeDisabled();
  await expect(compound).toHaveAttribute("title", "Select 2+ muscles first");
  await expect(page.getByText("Compound needs 2+ muscles selected below.")).toBeVisible();

  // equipment edit persists across reload (independent-field PATCH)
  await page.getByRole("button", { name: "Bodyweight" }).click();
  await expect(page.getByRole("button", { name: "Bodyweight" })).toHaveClass(/on/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Bodyweight" })).toHaveClass(/on/);

  // tag 2 muscles (each chip: one click → primary/.on) → Compound becomes enabled (gate lifts)
  const chips = page.locator(".chip-toggle", { hasText: /Chest|Lat|Quad|Bicep|Tricep|Front delt/ });
  await chips.nth(0).click();
  await chips.nth(1).click();
  await expect(page.getByRole("button", { name: "Compound" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Compound" })).toBeEnabled();   // muscle tags persisted
});
