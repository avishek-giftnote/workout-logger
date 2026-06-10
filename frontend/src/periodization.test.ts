import { describe, it, expect } from "vitest";
import { isDeload, targetSets, currentMicro, planMacrocycle } from "./periodization";
import type { ExerciseDto, MacrocycleDto, MesoInput, Muscle, WorkoutDto } from "./api/types";

const meso = (over: Partial<MesoInput> = {}): MesoInput =>
  ({ name: "M", accumulationWeeks: 4, phase: "SURPLUS", focusMuscles: ["CHEST"], blockType: "HYPERTROPHY", intensityBand: null, ...over });

const ex = (id: string, name: string, muscle: Muscle): ExerciseDto => ({
  id, name, isBodyweight: false, equipment: null, category: "STRENGTH", defaultUnit: "kg",
  restSeconds: null, cardioMetrics: null, muscleContributions: [{ muscle, fraction: "1.0" }],
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
  it("a DEFICIT trims a hypertrophy target (~20%) without changing the block type", () => {
    expect(targetSets("CHEST", meso({ phase: "DEFICIT" }), 4)).toBe(16);        // 20 × 0.8
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
});
