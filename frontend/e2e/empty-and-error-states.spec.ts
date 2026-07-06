import { test, expect } from "@playwright/test";
import { register } from "./helpers";

// LOW-MEDIUM — the reliability layer (ErrorBoundary/QueryError) and the seeded-catalog contract. The 500
// is the one sanctioned mock (a live 500 isn't reachable by legitimate user action), mirroring
// plan-slots-mocked.spec.ts.
test("a failed workouts fetch shows the QueryError retry UI, then recovers on retry", async ({ page }) => {
  await register(page);
  // force /api/workouts to 500 (route-intercept), then land on the log
  let fail = true;
  await page.route("**/api/workouts", (route) => {
    if (fail && route.request().method() === "GET") return route.fulfill({ status: 500, body: "{}" });
    return route.continue();
  });
  await page.goto("/previous-workouts");
  await expect(page.getByRole("heading", { name: "Couldn't load data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();

  fail = false;                                   // un-break the endpoint, then retry
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Couldn't load data" })).toHaveCount(0);
  await expect(page.getByText("No sessions yet")).toBeVisible();   // real (empty) data now loads
});

test("fresh account: empty training log + exactly the 84 seeded default exercises", async ({ page }) => {
  await register(page);
  await page.goto("/previous-workouts");
  await expect(page.getByText("No sessions yet")).toBeVisible();
  await expect(page.getByText("Your logged workouts will appear here.")).toBeVisible();

  // DefaultExerciseSeeder is a concrete contract: exactly 84 exercises for a new user (assert the number,
  // not ">0"). A drift in default-exercises.json flips this — intended.
  await page.getByRole("button", { name: "Exercises" }).click();
  await expect(page.getByText("84 exercises", { exact: true })).toBeVisible();   // exact: "184 exercises" must NOT pass
});
