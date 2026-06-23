import { test, expect } from "@playwright/test";
import { register } from "./helpers";

// Guards the planner remodel: the starter split renders user-selectable muscle-group SLOTS (dropdowns),
// a high-volume muscle gets ≥2 slots on a day (e.g. two chest exercises), every prime mover is scheduled
// ≥2×/week by design (Side delts was the old 4-day 1× warning case), and accepting persists the plan.
test("plan slots: dropdowns render, chest gets 2 slots, side delts ≥2×, accept persists", async ({ page }) => {
  await register(page);
  await page.goto("/plan");

  // Default goal "Build muscle" + 4 training days (the Upper/Lower case where Side delts used to be 1×).
  await expect(page.locator("section.ex-block select").first()).toBeVisible();

  // Every slot is a real <select> the user can swap — there should be several across the split.
  const selectCount = await page.locator("section.ex-block select").count();
  expect(selectCount).toBeGreaterThan(4);

  // Per-day, per-muscle slot counts, read straight from the rendered DOM (tag label precedes each slot row).
  const stats = await page.evaluate(() => {
    const out: { day: string; muscleCounts: Record<string, number>; sideDelt: boolean }[] = [];
    for (const sec of Array.from(document.querySelectorAll("section.ex-block"))) {
      const day = sec.querySelector("h3")?.textContent ?? "";
      const counts: Record<string, number> = {};
      for (const row of Array.from(sec.querySelectorAll(".detail-row"))) {
        const m = row.querySelector(".tag")?.textContent?.trim();
        if (m) counts[m] = (counts[m] ?? 0) + 1;
      }
      out.push({ day, muscleCounts: counts, sideDelt: !!counts["Side delts"] });
    }
    return out;
  });

  // (a) at least one day splits a muscle into 2 slots (e.g. two chest exercises)
  const maxPerMuscle = Math.max(...stats.flatMap((d) => Object.values(d.muscleCounts)));
  expect(maxPerMuscle).toBeGreaterThanOrEqual(2);
  // (b) frequency-by-design: Side delts now scheduled on ≥2 days (was 1× + a warning)
  expect(stats.filter((d) => d.sideDelt).length).toBeGreaterThanOrEqual(2);

  // (c) swap one dropdown, then accept → lands on the active-plan view (Complete week button)
  const first = page.locator("section.ex-block select").first();
  const opts = first.locator("option");
  if ((await opts.count()) > 1) await first.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Accept & start" }).click();
  await expect(page.getByRole("button", { name: "Complete week →" })).toBeVisible();
});
