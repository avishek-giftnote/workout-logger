import { test, expect } from "@playwright/test";
import { register, logSet, PASSWORD } from "./helpers";

// P0 — "Confirm Account Wipe": a signed-in user permanently deletes their account + all data. The real guard
// (server-side password re-verification) and the cascade completeness/tenant-isolation are pinned in
// ApiIntegrationTest; this is the UI journey — the wrong password is rejected, the typed phrase gates the
// button, and a correct wipe drops the user to the login screen with their credentials no longer valid.
test("account wipe: wrong password is rejected; correct wipe deletes the account and signs out", async ({ page }) => {
  test.slow();   // register + a logged workout + wipe over remote Atlas

  const email = await register(page);
  await logSet(page, "Barbell Bench Press", "100", "5");   // some data to be wiped

  // Open the danger zone → the confirm modal.
  await page.getByTitle("Settings").click();
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("heading", { name: "Confirm Account Wipe" })).toBeVisible();

  const deleteBtn = page.getByRole("button", { name: "Permanently delete" });

  // The button is disabled until the phrase is typed exactly.
  await expect(deleteBtn).toBeDisabled();
  await page.getByPlaceholder("DELETE").fill("DELETE");
  await page.locator("#wipe-pw").fill("the-wrong-password");
  await expect(deleteBtn).toBeEnabled();

  // Wrong password → server rejects (403), the modal stays open with an error, account NOT deleted.
  await deleteBtn.click();
  await expect(page.getByText("Incorrect password")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Confirm Account Wipe" })).toBeVisible();

  // Correct password → 204, dropped to the login screen (the token died with the account).
  await page.locator("#wipe-pw").fill(PASSWORD);
  await deleteBtn.click();
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible({ timeout: 20_000 });

  // The credentials no longer work — the account is gone.
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});
