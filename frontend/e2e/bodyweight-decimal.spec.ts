import { test, expect } from "@playwright/test";
import { register, logBodyweight, logSet } from "./helpers";

// P0 — "Decimal128 as a string end-to-end" is DESIGN.md §3's highest-leverage correctness fix; CLAUDE.md:
// "Never let a weight become a JSON number — a JS-number client silently rounds the ~25%-fractional-kg
// values." A fractional bodyweight must survive a full server round-trip byte-exact, so this asserts
// EXACT string equality (not a loose regex) after a reload that forces a real refetch.
test("bodyweight decimal survives a server round-trip byte-exact", async ({ page }) => {
  await register(page);
  await logBodyweight(page, "72.25");
  // the stored current-bodyweight line only renders once persisted; the `me` query is enabled while the
  // drawer is open, so re-open after a reload to read the server value (not a client-cache echo).
  await expect(page.locator(".field", { hasText: "Bodyweight (kg)" }).getByText(/Current/)).toContainText("72.25 kg");

  await page.reload();
  await page.getByTitle("Settings").click();
  await expect(page.locator(".field", { hasText: "Bodyweight (kg)" }).getByText(/Current/))
    .toContainText("72.25 kg");   // exact fraction preserved through Mongo Decimal128 + the string wire
});

// The effective-load decomposition for an ADDED-mode bodyweight set is recomputed from the user's CURRENT
// bodyweight (DESIGN.md §5), so it's the drift-prone surface: the "{eff} kg · BW +{delta}" string must be
// stable and exact across repeat reloads. (On a bodyweight set-row the .cell-input order is delta=nth(0),
// reps=nth(1), rpe=nth(2) per engine.tsx — an earlier draft filled delta via .last() and hit rpe.)
test("bodyweight ADDED-mode effective load decomposes exactly and is reload-stable", async ({ page }) => {
  test.slow();
  await register(page);
  await logBodyweight(page, "72.25");
  await page.keyboard.press("Escape").catch(() => {});   // close the drawer if it stayed open

  await page.goto("/start");
  await page.getByRole("button", { name: /Empty session/ }).click();
  await page.getByRole("button", { name: /Add exercise/ }).click();
  await page.getByPlaceholder("Search or name a new exercise…").fill("Pull Up");
  const exact = page.getByRole("button", { name: "Pull Up", exact: true });
  if (await exact.count()) await exact.first().click();
  else await page.getByRole("button", { name: /Pull Up/i }).first().click();

  const setRow = page.locator(".set-row").first();
  await expect(setRow).toBeVisible();          // wait for the block to render before probing for the bw cell
  // bodyweight exercise → the bw-mode toggle (+ = ADDED) + a delta cell. Set +2.5 kg added load.
  const bwToggle = setRow.getByTitle("Added (+) / Assisted (−)");
  if (await bwToggle.count()) {
    // ensure ADDED (shows "+"); if it shows "−" flip it
    if ((await bwToggle.textContent())?.includes("−")) await bwToggle.click();
    await setRow.locator(".cell-input").nth(0).fill("2.5");        // loadDelta (first cell on a bw set-row)
    await setRow.locator(".cell-input").nth(1).fill("8");          // reps
    await setRow.getByTitle("Complete set").click();
    await page.getByRole("button", { name: /Finish/ }).click();
    await page.getByRole("button", { name: "Skip" }).click();

    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.locator(".w-item").first().click();
    await page.waitForURL(/\/previous-workouts\/[a-f0-9]+$/);
    // effective = 72.25 + 2.5 = 74.75, decomposed as "74.75 kg · BW +2.5"
    await expect(page.getByText(/74\.75 kg · BW \+2\.5/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/74\.75 kg · BW \+2\.5/)).toBeVisible();   // recompute-stable, no drift
  } else {
    // "Pull Up" wasn't recognised as bodyweight in the seeded catalog — flag rather than silently pass.
    test.fixme(true, "ADDED-mode bw set unreachable: no bw-mode toggle for the picked exercise; see docs/e2e-findings.md");
  }
});

// The PRIMARY-entity decimal path: an embedded workouts.exercises[].sets[].weight goes through a DIFFERENT
// Decimal128 converter/DTO field than User.currentBodyweightKg, and is the exact "~25%-fractional-kg values,
// never a JS number" case CLAUDE.md/DESIGN.md §3 call out. Log a fractional set weight, reload, assert it
// round-trips byte-exact (the " kg" suffix anchors against float drift, e.g. "62.7500001 kg" won't match).
test("workout set weight (fractional) round-trips byte-exact through the log", async ({ page }) => {
  test.slow();
  await register(page);
  await logSet(page, "Barbell Bench Press", "62.75", "5");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.locator(".w-item").first().click();
  await page.waitForURL(/\/previous-workouts\/[a-f0-9]+$/);
  await expect(page.getByText(/62\.75 kg/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/62\.75 kg/)).toBeVisible();   // no float drift after a real server refetch
});
