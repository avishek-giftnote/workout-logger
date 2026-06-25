import { test, expect, type Route } from "@playwright/test";

// DB-less render verification of the planner remodel: the API is mocked at the network layer so the REAL
// PlanPage renders deterministically (no backend/Mongo needed). Confirms slots render as dropdowns, a
// high-volume muscle splits into 2 slots ONLY as a distinct-mechanic pair (chest: a compound press + an
// isolation fly), every prime mover (Side delts here) is scheduled ≥2×/week, and the user's per-slot choice
// flows through the accept payload.
type Ex = { muscle: string; mechanic?: string };
const ex = (id: string, name: string, m: string, mechanic = "COMPOUND") => ({
  id, name, isBodyweight: false, equipment: null, category: "STRENGTH", defaultUnit: "kg",
  restSeconds: null, cardioMetrics: null, muscleContributions: [{ muscle: m, fraction: "1.0" }],
  laterality: null, mechanic, loadable: true,
});
const CATALOG = [
  ex("c1", "Bench Press", "CHEST"), ex("c2", "Cable Fly", "CHEST", "ISOLATION"),   // distinct-mechanic pair → 2 slots
  ex("lat", "Barbell Row", "LAT"), ex("ub", "Face Pull", "UPPER_BACK"),
  ex("sd", "Lateral Raise", "SIDE_DELT"), ex("fd", "Front Raise", "FRONT_DELT"), ex("rd", "Rear Fly", "REAR_DELT"),
  ex("bi", "Barbell Curl", "BICEP"), ex("tri", "Pushdown", "TRICEP"),
  ex("q", "Back Squat", "QUAD"), ex("h", "Romanian Deadlift", "HAMSTRING"), ex("g", "Hip Thrust", "GLUTE"),
  ex("calf", "Calf Raise", "CALF"), ex("ab", "Cable Crunch", "ABS"),
];
const ENERGY = { status: "GATHERING_DATA", phase: "UNKNOWN", confidence: "NONE", weighIns: 0, spanDays: 0,
  minWeighIns: 4, minSpanDays: 14, ratePerWeekKg: null, maintenanceKcalLow: null, maintenanceKcalHigh: null,
  surplusDeficitKcalLow: null, surplusDeficitKcalHigh: null, missingProfile: [] };
const ME = { id: "u1", email: "mock@example.com", currentBodyweightKg: "60", bodyweightLog: [], profile: null };
const ACTIVE_PLAN = {
  id: "p1", name: "Build muscle — 6 mo", startedAt: new Date(0).toISOString(), status: "ACTIVE",
  mesoIndex: 0, week: 1, goal: "GENERAL_HYPERTROPHY", targetDate: null, focusMuscles: [],
  mesocycles: [{ name: "Hypertrophy 1", accumulationWeeks: 4, phase: "SURPLUS", focusMuscles: [],
    blockType: "HYPERTROPHY", intensityBand: { repLow: 8, repHigh: 15, targetRir: "1-2", pctLow: "0.65", pctHigh: "0.75" } }],
};

test("plan slots (mocked): dropdowns render, chest→2 slots, side delts ≥2×, choice flows to accept payload", async ({ page }) => {
  const postedTemplates: { name: string; exercises: { exerciseId: string }[] }[] = [];
  let planCreated = false;

  // Match only true backend calls (pathname /api/…), NOT Vite's own source modules under /src/api/.
  await page.route((url) => url.pathname.startsWith("/api/"), async (route: Route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/me") return json(ME);
    if (p === "/me/settings") return json({ settings: {}, updatedAt: "0" });
    if (p === "/me/energy") return json(ENERGY);
    if (p === "/exercises") return json(CATALOG);
    if (p === "/workouts") return json([]);
    if (p === "/plan" && method === "GET") return json(planCreated ? ACTIVE_PLAN : null);
    if (p === "/plan" && method === "POST") { planCreated = true; return json(ACTIVE_PLAN); }
    if (p === "/templates" && method === "POST") {
      const body = JSON.parse(route.request().postData() || "{}");
      postedTemplates.push(body);
      return json({ id: `t${postedTemplates.length}`, name: body.name, exercises: body.exercises });
    }
    if (p === "/splits" && method === "POST") return json({ id: "s1", name: "split", templateIds: [] });
    if (p === "/templates" || p === "/splits") return json([]);
    return json(null);
  });

  await page.addInitScript(() => localStorage.setItem("wl.token", "mock-token"));
  await page.goto("/plan");

  // Default goal "Build muscle" + 4 training days (the Upper/Lower case where Side delts used to be 1×).
  await expect(page.locator("section.ex-block select").first()).toBeVisible();

  // every slot is a swappable <select>
  expect(await page.locator("section.ex-block select").count()).toBeGreaterThan(4);

  // per-day, per-muscle slot counts read from the DOM
  const stats = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("section.ex-block")).map((sec) => {
      const counts: Record<string, number> = {};
      for (const row of Array.from(sec.querySelectorAll(".detail-row"))) {
        const m = row.querySelector(".tag")?.textContent?.trim();
        if (m) counts[m] = (counts[m] ?? 0) + 1;
      }
      return counts;
    });
  });
  // (a) a muscle splits into 2 slots somewhere (chest: MEV 8 / freq 2 = 4 sets → a compound + isolation pair)
  expect(Math.max(...stats.flatMap((c) => Object.values(c)))).toBeGreaterThanOrEqual(2);
  // and a single-candidate prime mover (Side delts) stays ONE exercise — no redundant 2nd slot
  expect(Math.max(...stats.map((c) => c["Side delts"] ?? 0))).toBe(1);
  // (b) frequency-by-design: Side delts scheduled on ≥2 days (the old 4-day 1× warning case)
  expect(stats.filter((c) => c["Side delts"]).length).toBeGreaterThanOrEqual(2);

  // (c) swap the first dropdown, accept, and confirm the chosen exercise lands in the POSTed templates
  const first = page.locator("section.ex-block select").first();
  await first.selectOption({ index: 1 });
  const chosen = await first.inputValue();
  await page.getByRole("button", { name: "Accept & start" }).click();
  await expect(page.getByRole("button", { name: "Complete week →" })).toBeVisible();

  const allPosted = postedTemplates.flatMap((t) => t.exercises.map((e) => e.exerciseId));
  expect(allPosted.length).toBeGreaterThan(0);
  expect(allPosted).toContain(chosen);                       // user's swap flowed through
  // a chest day persisted two distinct chest exercises (the 2-slot split, defaults un-merged)
  expect(postedTemplates.some((t) => t.exercises.filter((e) => e.exerciseId === "c1" || e.exerciseId === "c2").length >= 2
    || (t.exercises.some((e) => e.exerciseId === "c1") && t.exercises.some((e) => e.exerciseId === "c2")))).toBe(true);
});
