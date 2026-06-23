import { describe, it, expect } from "vitest";
import { isDeload, targetSets, currentMicro, planMacrocycle, phaseMod, daySlots } from "./periodization";
import type { ExerciseDto, MacrocycleDto, MesoInput, Muscle, WorkoutDto } from "./api/types";

const meso = (over: Partial<MesoInput> = {}): MesoInput =>
  ({ name: "M", accumulationWeeks: 4, phase: "MAINTENANCE", focusMuscles: ["CHEST"], blockType: "HYPERTROPHY", intensityBand: null, ...over });

const ex = (id: string, name: string, muscle: Muscle): ExerciseDto => ({
  id, name, isBodyweight: false, equipment: null, category: "STRENGTH", defaultUnit: "kg",
  restSeconds: null, cardioMetrics: null, muscleContributions: [{ muscle, fraction: "1.0" }],
  laterality: null, mechanic: null, loadable: null,
});

describe("isDeload", () => {
  it("is true only for DELOAD sessions", () => {
    expect(isDeload({ cyclePhase: "DELOAD" } as WorkoutDto)).toBe(true);
    expect(isDeload({ cyclePhase: null } as WorkoutDto)).toBe(false);
  });
});

describe("targetSets (MEV-reset ramp + bounded phase band-step)", () => {
  it("every trained muscle starts at MEV and ramps ~+2 sets/week, deload→~MV", () => {
    const m = meso();
    expect(targetSets("CHEST", m, 1)).toBe(8);    // MEV
    expect(targetSets("CHEST", m, 2)).toBe(10);   // +2
    expect(targetSets("CHEST", m, 4)).toBe(14);   // 8 + 2·3 (capped at MRV 20, not yet reached)
    expect(targetSets("CHEST", m, 5)).toBe(4);    // deload
  });
  it("ramps non-focus muscles too (toward MAV, not flat at MEV)", () => {
    expect(targetSets("LAT", meso(), 1)).toBe(10);   // MEV
    expect(targetSets("LAT", meso(), 4)).toBe(16);   // ramped toward MAV-high 18
  });
  it("STRENGTH block caps focus volume at MAV-low", () => {
    expect(targetSets("CHEST", meso({ blockType: "STRENGTH" }), 4)).toBe(12);   // MAV[0]
  });
  it("PEAK block sits at MV", () => {
    expect(targetSets("CHEST", meso({ blockType: "PEAK" }), 4)).toBe(4);        // MV
  });
  it("the energy phase shifts the target by ±one bounded band-step", () => {
    expect(targetSets("CHEST", meso({ phase: "MAINTENANCE" }), 4)).toBe(14);    // ramp
    expect(targetSets("CHEST", meso({ phase: "DEFICIT" }), 4)).toBe(13);        // −1 band-step
    expect(targetSets("CHEST", meso({ phase: "SURPLUS" }), 4)).toBe(15);        // +1 band-step
  });
});

describe("phaseMod", () => {
  it("returns the locked energy-phase modifiers; unknown → maintenance", () => {
    expect(phaseMod("DEFICIT")).toMatchObject({ volumeBandSign: -1, rirFloor: 1, progressMult: 0.1 });
    expect(phaseMod("SURPLUS").volumeBandSign).toBe(1);
    expect(phaseMod(null).progressMult).toBe(0.5);   // maintenance default
  });
});

describe("currentMicro", () => {
  const plan = (week: number): MacrocycleDto =>
    ({ id: "p", name: "P", startedAt: "", status: "ACTIVE", mesoIndex: 0, week,
       mesocycles: [meso() as never], goal: null, targetDate: null, focusMuscles: null });
  it("flags the deload week", () => {
    expect(currentMicro(plan(2))!.isDeload).toBe(false);
    expect(currentMicro(plan(5))!.isDeload).toBe(true);
  });
});

describe("planMacrocycle", () => {
  const catalog = [ex("1", "Bench Press", "CHEST"), ex("2", "Barbell Row", "LAT"), ex("3", "Back Squat", "QUAD")];

  it("tiles hypertrophy blocks for a dateless general goal, first block HYPERTROPHY", () => {
    const p = planMacrocycle("GENERAL_HYPERTROPHY", 16, null, [], 3, catalog);
    expect(p.mesocycles.length).toBeGreaterThanOrEqual(2);
    expect(p.mesocycles[0].blockType).toBe("HYPERTROPHY");
    expect(p.totalWeeks).toBeGreaterThan(0);
  });

  it("pins the focus muscle on every block for MUSCLE_FOCUS", () => {
    const p = planMacrocycle("MUSCLE_FOCUS", 12, null, ["SIDE_DELT"], 4, catalog);
    expect(p.mesocycles.every((b) => b.focusMuscles.includes("SIDE_DELT"))).toBe(true);
  });

  it("ends contest prep with a PEAK block, all blocks in a DEFICIT", () => {
    const date = new Date(Date.now() + 12 * 7 * 86_400_000).toISOString().slice(0, 10);
    const p = planMacrocycle("CONTEST_PREP", 0, date, ["GLUTE"], 5, catalog);
    expect(p.mesocycles[p.mesocycles.length - 1].blockType).toBe("PEAK");
    expect(p.mesocycles.every((b) => b.phase === "DEFICIT")).toBe(true);
  });

  it("generates a split with picked exercises and warns about uncovered focus muscles", () => {
    const p = planMacrocycle("MUSCLE_FOCUS", 8, null, ["SIDE_DELT"], 3, catalog);   // catalog has no side-delt exercise
    expect(p.templates.flatMap((t) => t.slots).length).toBeGreaterThan(0);          // chest/lat/quad slots get filled
    expect(p.warnings.some((w) => w.toLowerCase().includes("side delt"))).toBe(true);
  });

  // full catalog: one primary exercise per muscle, so a muscle's weekly frequency = its exercise's day count
  const ALL: Muscle[] = ["CHEST", "FRONT_DELT", "SIDE_DELT", "REAR_DELT", "LAT", "UPPER_BACK", "TRAP", "BICEP", "TRICEP", "FOREARM", "QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS"];
  const full = ALL.map((m, i) => ex(`m${i}`, `${m} lift`, m));
  const exId = (m: Muscle) => full[ALL.indexOf(m)].id;
  const freqOf = (p: ReturnType<typeof planMacrocycle>, m: Muscle) =>
    p.templates.filter((t) => t.slots.some((s) => s.exerciseId === exId(m))).length;

  it("trains each prime mover at least twice a week (4-day split)", () => {
    const p = planMacrocycle("GENERAL_HYPERTROPHY", 8, null, [], 4, full);
    for (const m of ["CHEST", "LAT", "QUAD", "HAMSTRING", "GLUTE"] as Muscle[]) {
      expect(freqOf(p, m)).toBeGreaterThanOrEqual(2);
    }
  });

  it("trains every prime mover ≥2× across 2-, 3-, 4-, 5-, 6-day splits", () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const p = planMacrocycle("GENERAL_HYPERTROPHY", 8, null, [], days, full);
      for (const m of ["CHEST", "LAT", "QUAD"] as Muscle[]) expect(freqOf(p, m)).toBeGreaterThanOrEqual(2);
    }
  });

  it("forces a focus muscle to ≥2× even when the base split would hit it once", () => {
    const p = planMacrocycle("MUSCLE_FOCUS", 8, null, ["SIDE_DELT"], 4, full);
    expect(freqOf(p, "SIDE_DELT")).toBeGreaterThanOrEqual(2);
  });

  it("populates target reps + RIR on every generated slot (load left for first log)", () => {
    const p = planMacrocycle("GENERAL_HYPERTROPHY", 8, null, [], 4, full);
    const slots = p.templates.flatMap((t) => t.slots);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.reps > 0 && /^\d+$/.test(s.targetRir))).toBe(true);
  });

  it("every slot's default exercise actually trains its target muscle", () => {
    const p = planMacrocycle("GENERAL_HYPERTROPHY", 8, null, [], 4, full);
    for (const t of p.templates) for (const s of t.slots) {
      expect(s.exerciseId).toBe(exId(s.muscle));   // full catalog: the only exercise for that muscle
    }
  });

  it("does not schedule a prime mover on back-to-back days (4–6 day splits)", () => {
    for (const days of [4, 5, 6]) {
      const p = planMacrocycle("GENERAL_HYPERTROPHY", 8, null, [], days, full);
      expect(p.warnings.some((w) => /back-to-back/.test(w))).toBe(false);
    }
  });
});

describe("daySlots — muscle-group placeholders with pre-filled defaults", () => {
  const block = (over: Partial<MesoInput> = {}): MesoInput =>
    ({ name: "M", accumulationWeeks: 4, phase: "MAINTENANCE", focusMuscles: [], blockType: "HYPERTROPHY", intensityBand: null, ...over });
  const press = ex("p1", "Incline Press", "CHEST");
  const fly = ex("p2", "Pec Deck", "CHEST");
  const day = (muscles: Muscle[]) => ({ name: "D", muscles });

  it("splits a muscle's daily volume across ≤2 distinct exercises, conserving total sets", () => {
    // CHEST (non-focus) week-1 target = MEV 8; at freq 2 → 4 sets/day → 2 slots (incline + pec deck)
    const { slots } = daySlots(day(["CHEST"]), block(), { CHEST: 2 }, { CHEST: [press, fly] }, {}, 8, "3");
    expect(slots.length).toBe(2);
    expect(slots.map((s) => s.exerciseId)).toEqual(["p2", "p1"]);     // rotated → distinct defaults
    expect(slots.every((s) => s.muscle === "CHEST")).toBe(true);
    expect(slots.reduce((n, s) => n + s.sets, 0)).toBe(4);            // volume conserved
  });

  it("uses a single slot when only one candidate exercise exists", () => {
    const { slots } = daySlots(day(["CHEST"]), block(), { CHEST: 2 }, { CHEST: [press] }, {}, 8, "3");
    expect(slots.length).toBe(1);
    expect(slots[0]).toMatchObject({ exerciseId: "p1", sets: 4 });
  });

  it("uses a single slot for low per-day volume (≤3 sets)", () => {
    // freq 4 → 8/4 = 2 sets/day → ⌈2/3⌉ = 1 slot even with two candidates
    const { slots } = daySlots(day(["CHEST"]), block(), { CHEST: 4 }, { CHEST: [press, fly] }, {}, 8, "3");
    expect(slots.length).toBe(1);
    expect(slots[0].sets).toBe(2);
  });

  it("reports a muscle with no candidate exercise as missing, emits no slot", () => {
    const { slots, missing } = daySlots(day(["CHEST", "SIDE_DELT"]), block(), { CHEST: 2, SIDE_DELT: 2 }, { CHEST: [press], SIDE_DELT: [] }, {}, 8, "3");
    expect(missing).toEqual(["SIDE_DELT"]);
    expect(slots.every((s) => s.muscle === "CHEST")).toBe(true);
  });

  it("never exceeds the per-session set cap on any single slot", () => {
    const { slots } = daySlots(day(["CHEST"]), block(), { CHEST: 1 }, { CHEST: [press] }, {}, 8, "3");
    expect(slots.every((s) => s.sets <= 5)).toBe(true);
  });
});
