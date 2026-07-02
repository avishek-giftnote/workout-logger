import { test, expect } from "@playwright/test";
import { register } from "./helpers";

// MEDIUM-HIGH — the data-sufficiency gate is a core coaching invariant (docs/coach.md: >=6 weigh-ins AND
// >=14-day span before a trend is shown). Below threshold the Coach card must render WORDS, never a raw
// number/phase — proving the gate, not the math (the tiers are owned by EnergyServiceTest).
test("coach gate: a fresh account shows GATHERING_DATA copy, never a trend number", async ({ page }) => {
  await register(page);
  await page.goto("/previous-workouts");
  // Coach card is enabled by default (the settings test toggles it OFF). Exact copy from CoachCard.tsx.
  const coach = page.locator(".coach");
  await expect(coach).toBeVisible();
  await expect(coach).toContainText("Gathering data — 0/6 weigh-ins over 0/14 days");
  // the gate must NOT leak a computed trend/phase below threshold
  await expect(coach).not.toContainText("kg/week");
  await expect(coach).not.toContainText(/Surplus|Deficit|Maintenance/);
});

// The GATHERING_DATA -> READY flip needs >=6 real weigh-ins spanning >14 days. Driving that through the UI
// date picker 6+ times is the batch's highest flake risk (council: stretch, API-seed). Pinned as a
// documented gap rather than shipped slow/flaky; see docs/e2e-findings.md.
test.fixme("coach gate: flips to READY after 6 weigh-ins over 14 days", async () => {
  // TODO: seed >=6 backdated non-estimated weigh-ins via the typed Api client, then assert the .coach-pill
  // (Surplus/Deficit/Maintenance) + "Trend ... kg/week" appears. Deltas chosen outside the +/-0.1%bw/wk
  // dead-band so the phase can't flap.
});
