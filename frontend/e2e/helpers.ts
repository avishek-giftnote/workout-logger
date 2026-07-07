import { expect, type Page } from "@playwright/test";

export const PASSWORD = "password123";
// Random suffix so parallel Playwright workers (separate processes) can't collide on the same email.
export const uniqueEmail = () => `e2e+${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}@example.com`;

/** Register a fresh account through the UI and land authenticated. Returns the email used. */
export async function register(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByRole("heading", { name: "Start lifting." })).toBeVisible();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // registration synchronously seeds the 84-exercise default catalog before the token returns, so the
  // authed shell can take >5s (the default expect timeout) under load — wait generously here.
  await expect(page.getByRole("button", { name: "History" })).toBeVisible({ timeout: 20_000 });   // topbar nav ⇒ authed
  return email;
}

/**
 * Log one working set of `exerciseName` (picking/creating it via the picker), tick it done, finish the
 * session, and skip the "save as template?" prompt. Lands on /previous-workouts. Extracted from
 * critical-paths so multiple specs share one reliable logging path.
 */
export async function logSet(page: Page, exerciseName: string, weight: string, reps: string): Promise<void> {
  await page.goto("/start");
  // /start gates "Empty session" behind the templates/splits queries; against remote Atlas those can be
  // slow, so wait explicitly (generous) rather than race the shared test budget.
  const emptyBtn = page.getByRole("button", { name: /Empty session/ });
  await emptyBtn.waitFor({ state: "visible", timeout: 30_000 });
  await emptyBtn.click();
  await expect(page.getByRole("heading", { name: "Log Session" })).toBeVisible();
  await page.getByRole("button", { name: /Add exercise/ }).click();
  await page.getByPlaceholder("Search or name a new exercise…").fill(exerciseName);
  // exact match if it's a default; otherwise the create affordance is a button labelled Create "<name>"
  const exact = page.getByRole("button", { name: exerciseName, exact: true });
  if (await exact.count()) await exact.first().click();
  else await page.getByRole("button", { name: new RegExp(`Create `) }).first().click();
  const setRow = page.locator(".set-row").first();
  await expect(setRow).toBeVisible();          // the block + its blank set render after the (async) pick/create
  await setRow.locator(".cell-input").nth(0).fill(weight);
  await setRow.locator(".cell-input").nth(1).fill(reps);
  await setRow.getByTitle("Complete set").click();
  await page.getByRole("button", { name: /Finish/ }).click();
  // a fresh lineup always prompts "save as a template?" — click Skip (auto-waits; a racy count() check
  // short-circuits before the prompt renders and leaves it open, stranding the session on /start).
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page).toHaveURL(/\/previous-workouts/);
}

/** Log one cardio set (distance km + time mm:ss) on `exerciseName` (a CARDIO exercise), finish, skip. */
export async function logCardio(page: Page, exerciseName: string, km: string, time: string): Promise<void> {
  await page.goto("/start");
  const emptyBtn = page.getByRole("button", { name: /Empty session/ });
  await emptyBtn.waitFor({ state: "visible", timeout: 30_000 });
  await emptyBtn.click();
  await page.getByRole("button", { name: /Add exercise/ }).click();
  await page.getByPlaceholder("Search or name a new exercise…").fill(exerciseName);
  // non-exact: a bodyweight cardio exercise's result button also carries a "BW" tag in its name
  await page.getByRole("button", { name: exerciseName }).first().click();
  const row = page.locator(".cardio-row").first();
  await expect(row).toBeVisible();
  await row.locator(".cell-input").nth(0).fill(km);      // distance (km)
  await row.locator(".cell-input").nth(1).fill(time);    // time (mm:ss)
  await row.getByTitle("Complete set").click();
  await page.getByRole("button", { name: /Finish/ }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page).toHaveURL(/\/previous-workouts/);
}

/** Log a bodyweight measurement through the settings drawer. Leaves the drawer open. */
export async function logBodyweight(page: Page, kg: string): Promise<void> {
  await page.getByTitle("Settings").click();
  const field = page.locator(".field", { hasText: "Bodyweight (kg)" });
  await field.locator("input.mono").first().fill(kg);
  await field.getByRole("button", { name: "Save" }).click();
}
