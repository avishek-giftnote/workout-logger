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
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();   // topbar nav ⇒ authed
  return email;
}
