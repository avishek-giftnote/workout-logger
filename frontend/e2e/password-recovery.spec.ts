import { test, expect } from "@playwright/test";
import { register, readEmailCode, PASSWORD, uniqueEmail } from "./helpers";

// P0 — "Retake ownership": a user who forgot their password proves email ownership with a 6-digit code and
// sets a new one. On success the device is signed in (auto-sign-in) and every other session is revoked.
// Backend correctness (revocation ordering, enumeration neutrality, single-use) is pinned in ApiIntegrationTest;
// this is the UI-layer journey: the recover flow reaches the authenticated shell, and the NEW password works
// afterwards while the OLD one no longer does.
test("password recovery: forgotten password is reset via emailed code, then the new password logs in", async ({ page }) => {
  test.slow();   // register + recover + two logins over remote Atlas — well past the 30s default budget

  // A real account exists (created with the shared PASSWORD), then signed out.
  const email = uniqueEmail();
  await register(page, email);
  const signupCode = await readEmailCode(email);   // remember it so recovery waits for a DIFFERENT code
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();

  // Retake ownership → request a recovery code.
  await page.getByRole("button", { name: "Retake ownership" }).click();
  await expect(page.getByRole("heading", { name: "Retake ownership." })).toBeVisible();
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email." })).toBeVisible();

  // Enter the recovery code + a NEW password → lands authenticated (auto-sign-in).
  const NEW_PASSWORD = "brand-new-pass-99";
  const code = await readEmailCode(email, signupCode);
  await page.getByPlaceholder("6-digit code").fill(code);
  await page.locator("#password").fill(NEW_PASSWORD);
  await page.locator("#confirm").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible({ timeout: 20_000 });

  // Sign out, then confirm the OLD password is dead and the NEW one works.
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();

  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator("#password").fill(PASSWORD);   // the original password
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  await page.locator("#password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible({ timeout: 20_000 });
});
