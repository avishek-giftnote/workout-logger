import { test, expect } from "@playwright/test";
import { register, uniqueEmail, PASSWORD } from "./helpers";

test.describe("critical paths", () => {
  test("register → authenticated, with the default catalog seeded", async ({ page }) => {
    await register(page);
    // topbar nav is the authed shell; the start screen is the default route
    await expect(page.getByRole("heading", { name: "Start Workout" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plan" })).toBeVisible();
  });

  test("a wrong password shows a credentials error, not 'session expired'", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("you@example.com").fill(uniqueEmail());   // never-registered account
    await page.getByPlaceholder("••••••••").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("log a workout, see it in history, then edit it — all persisted", async ({ page }) => {
    await register(page);

    // start an empty session, add an exercise, log one working set
    await page.getByRole("button", { name: /Empty session/ }).click();
    await expect(page.getByRole("heading", { name: "Log Session" })).toBeVisible();
    await page.getByRole("button", { name: /Add exercise/ }).click();
    await page.getByPlaceholder("Search or name a new exercise…").fill("Barbell Bench");
    await page.getByRole("button", { name: "Barbell Bench Press", exact: true }).click();

    // the block starts with one (blank) set — fill it and tick it done
    const setRow = page.locator(".set-row").first();
    await setRow.locator(".cell-input").nth(0).fill("60");   // weight
    await setRow.locator(".cell-input").nth(1).fill("5");    // reps
    await setRow.getByTitle("Complete set").click();

    await page.getByRole("button", { name: /Finish/ }).click();
    // new lineup → "Save as a template?" → skip
    await page.getByRole("button", { name: "Skip" }).click();

    // it lands in the training log; the card is labelled by its exercise (list view)
    await expect(page).toHaveURL(/\/previous-workouts/);
    await page.getByRole("button", { name: "List", exact: true }).click();
    const card = page.locator(".w-item").first();
    await expect(card).toContainText("Barbell Bench Press");

    // it survives a reload (persisted server-side)
    await page.reload();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.locator(".w-item").first()).toContainText("Barbell Bench Press");

    // open it, edit the weight, save, and confirm the change persisted
    await page.locator(".w-item").first().click();
    await page.getByRole("button", { name: /Edit workout/ }).click();
    await expect(page.getByRole("heading", { name: "Edit Session" })).toBeVisible();
    await page.locator(".set-row").first().locator(".cell-input").nth(0).fill("65");
    await page.getByRole("button", { name: /Save changes/ }).click();
    await page.waitForURL(/previous-workouts\/[a-f0-9]+$/, { timeout: 10000 });
    await page.reload();   // clean detail load (avoid the post-save refetch flicker)
    await expect(page.getByText("Barbell Bench Press").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/65/).first()).toBeVisible();
  });

  test("settings persist across a reload (Coach toggle)", async ({ page }) => {
    await register(page);
    await page.getByTitle("Settings").click();
    const coach = page.locator(".field", { hasText: "Coach (energy estimate)" });
    await coach.getByRole("button", { name: "Off" }).click();
    await expect(coach.getByRole("button", { name: "Off" })).toHaveClass(/on/);

    await page.reload();
    await page.getByTitle("Settings").click();
    const coachAfter = page.locator(".field", { hasText: "Coach (energy estimate)" });
    await expect(coachAfter.getByRole("button", { name: "Off" })).toHaveClass(/on/);   // setting stuck
  });
});
