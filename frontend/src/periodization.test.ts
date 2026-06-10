import { describe, it, expect } from "vitest";
import { isDeload, targetSets, currentMicro } from "./periodization";
import type { MacrocycleDto, MesocycleDto, WorkoutDto } from "./api/types";

const meso = (over: Partial<MesocycleDto> = {}): MesocycleDto =>
  ({ name: "M", accumulationWeeks: 4, phase: "SURPLUS", focusMuscles: ["CHEST"], ...over });

describe("isDeload", () => {
  it("is true only for DELOAD sessions", () => {
    expect(isDeload({ cyclePhase: "DELOAD" } as WorkoutDto)).toBe(true);
    expect(isDeload({ cyclePhase: null } as WorkoutDto)).toBe(false);
    expect(isDeload({ cyclePhase: "ACCUMULATION" } as WorkoutDto)).toBe(false);
  });
});

describe("targetSets", () => {
  const m = meso();
  it("ramps a focus muscle MEV→ceiling across accumulation", () => {
    expect(targetSets("CHEST", m, 1)).toBe(8);    // MEV at week 1
    expect(targetSets("CHEST", m, 4)).toBe(20);   // MRV ceiling (surplus) at the last accumulation week
  });
  it("drops to ~MV on the deload week", () => {
    expect(targetSets("CHEST", m, 5)).toBe(4);
  });
  it("holds non-focus muscles at MEV", () => {
    expect(targetSets("LAT", m, 4)).toBe(10);
  });
  it("caps the ceiling lower in a deficit", () => {
    expect(targetSets("CHEST", meso({ phase: "DEFICIT" }), 4)).toBe(12);   // MAV low
  });
});

describe("currentMicro", () => {
  const plan = (week: number): MacrocycleDto =>
    ({ id: "p", name: "P", startedAt: "", status: "ACTIVE", mesoIndex: 0, week, mesocycles: [meso()] });
  it("flags the deload week (accumulationWeeks + 1)", () => {
    expect(currentMicro(plan(2))!.isDeload).toBe(false);
    expect(currentMicro(plan(5))!.isDeload).toBe(true);
    expect(currentMicro(plan(3))!.weeks).toBe(5);
  });
});
