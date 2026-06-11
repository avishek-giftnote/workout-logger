import { describe, it, expect } from "vitest";
import { isDeload, targetSets, currentMicro, planMacrocycle, phaseMod } from "./periodization";
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

describe("targetSets (blockType ⟂ phase)", () => {
  it("hypertrophy focus ramps MEV→MRV, deload→~MV", () => {
    const m = meso();
    expect(targetSets("CHEST", m, 1)).toBe(8);    // MEV
    expect(targetSets("CHEST", m, 4)).toBe(20);   // MRV
    expect(targetSets("CHEST", m, 5)).toBe(4);    // deload
  });
  it("holds non-focus muscles at MEV", () => {
    expect(targetSets("LAT", meso(), 4)).toBe(10);
  });
  it("STRENGTH block caps focus volume at MAV-low (intensity carries the load)", () => {
    expect(targetSets("CHEST", meso({ blockType: "STRENGTH" }), 4)).toBe(12);   // MAV[0]
  });
  it("PEAK block drops to MV", () => {
    expect(targetSets("CHEST", meso({ blockType: "PEAK" }), 4)).toBe(4);        // MV
  });
  it("scales the ceiling by the energy phase (orthogonal to block type)", () => {
    expect(targetSets("CHEST", meso({ phase: "DEFICIT" }), 4)).toBe(17);        // MRV 20 × 0.85
    expect(targetSets("CHEST", meso({ phase: "SURPLUS" }), 4)).toBe(21);        // MRV 20 × 1.05
    expect(targetSets("CHEST", meso({ phase: "MAINTENANCE" }), 4)).toBe(20);    // MRV 20 × 1.0
  });
});

describe("phaseMod", () => {
  it("returns the locked energy-phase modifiers; unknown → maintenance", () => {
    expect(phaseMod("DEFICIT")).toMatchObject({ volumeMult: 0.85, rirFloor: 1, progressMult: 0.1 });
    expect(phaseMod("SURPLUS").volumeMult).toBe(1.05);
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
    expect(p.templates.flatMap((t) => t.exercises).length).toBeGreaterThan(0);      // chest/lat/quad get filled
    expect(p.warnings.some((w) => w.toLowerCase().includes("side delt"))).toBe(true);
  });

  // full catalog: one primary exercise per muscle, so a muscle's weekly frequency = its exercise's day count
  const ALL: Muscle[] = ["CHEST", "FRONT_DELT", "SIDE_DELT", "REAR_DELT", "LAT", "UPPER_BACK", "TRAP", "BICEP", "TRICEP", "FOREARM", "QUAD", "HAMSTRING", "GLUTE", "CALF", "ABS"];
  const full = ALL.map((m, i) => ex(`m${i}`, `${m} lift`, m));
  const exId = (m: Muscle) => full[ALL.indexOf(m)].id;
  const freqOf = (p: ReturnType<typeof planMacrocycle>, m: Muscle) =>
    p.templates.filter((t) => t.exercises.some((e) => e.exerciseId === exId(m))).length;

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

  it("populates target reps + RIR on every generated exercise (load left for first log)", () => {
    const p = planMacrocycle("GENERAL_HYPERTROPHY", 8, null, [], 4, full);
    const exs = p.templates.flatMap((t) => t.exercises);
    expect(exs.length).toBeGreaterThan(0);
    expect(exs.every((e) => e.reps > 0 && /^\d+$/.test(e.targetRir))).toBe(true);
  });
});
