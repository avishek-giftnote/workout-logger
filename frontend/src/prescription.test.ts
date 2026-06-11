import { describe, it, expect } from "vitest";
import { rpePct, e1rm, roundInc, loadIncrement, workingLoad, topWorkingSet, nextLoad, readiness, rirWave } from "./prescription";
import type { Muscle, SetDto, WorkoutDto } from "./api/types";

const set = (over: Partial<SetDto> = {}): SetDto => ({
  id: "s", orderIndex: 0, setType: "WORKING", weight: "100", loadMode: null, loadDelta: null,
  weightUnit: "kg", reps: 8, rpe: null, note: null, estimated: null, kind: "STRENGTH",
  distanceM: null, durationS: null, gradePct: null, elevationGainM: null, cadenceSpm: null, ...over,
});
const wk = (id: string, startedAt: string, sets: SetDto[], over: Partial<WorkoutDto> = {}): WorkoutDto => ({
  id, startedAt, durationSeconds: null, rawDurationText: null, templateId: null, cyclePhase: null,
  exercises: [{ exerciseId: "x", name: "X", position: 0, note: null, sets }], soreMuscles: null,
  createdAt: "", updatedAt: "", ...over,
});

describe("rpePct (RTS table: 100 − 2.5(reps−1) − 5·RIR)", () => {
  it("reproduces table cells", () => {
    expect(rpePct(1, 0)).toBeCloseTo(1.0);     // 1 @ 0 RIR = 100%
    expect(rpePct(5, 2)).toBeCloseTo(0.80);    // 5 @ 2 RIR = 80%
    expect(rpePct(8, 2)).toBeCloseTo(0.725);   // 8 @ 2 RIR = 72.5%
    expect(rpePct(10, 1)).toBeCloseTo(0.725);  // 10 @ 1 RIR = 72.5%
  });
  it("clamps to [0.40, 1.0]", () => {
    expect(rpePct(1, 0)).toBe(1.0);
    expect(rpePct(30, 5)).toBe(0.40);
  });
});

describe("e1rm", () => {
  it("Epley without RPE", () => expect(e1rm(100, 10)).toBeCloseTo(133.33, 1));
  it("RPE-adjusts a non-failure set (315×5 @ RPE8 → 394)", () => expect(e1rm(315, 5, 8)).toBeCloseTo(393.75, 1));
});

describe("roundInc / loadIncrement / workingLoad", () => {
  it("rounds to the increment", () => {
    expect(roundInc(112.3, 2.5)).toBe(112.5);
    expect(roundInc(41.2, 1.25)).toBe(41.25);
  });
  it("smaller increment for isolation", () => {
    expect(loadIncrement({ mechanic: "ISOLATION" })).toBe(1.25);
    expect(loadIncrement({ mechanic: "COMPOUND" })).toBe(2.5);
  });
  it("derives a working load from e1RM, reps, RIR (e1RM 140, 5×2RIR → 80% → 112.5)", () => {
    expect(workingLoad(140, 5, 2, 2.5)).toBe(112.5);
  });
});

describe("topWorkingSet", () => {
  it("most recent session's heaviest working set, ignoring warmups + deload", () => {
    const data = [
      wk("1", "2026-01-01", [set({ weight: "90" })]),
      wk("2", "2026-02-01", [set({ setType: "WARMUP", weight: "200" }), set({ weight: "110", reps: 6 }), set({ weight: "100", reps: 8 })]),
      wk("3", "2026-03-01", [set({ weight: "999" })], { cyclePhase: "DELOAD" }),   // deload excluded
    ];
    expect(topWorkingSet(data, "x")).toMatchObject({ weight: 110, reps: 6 });
  });
  it("null with no working history", () => expect(topWorkingSet([], "x")).toBeNull());
});

describe("nextLoad (double progression)", () => {
  const prev = (weight: number, reps: number) => ({ weight, reps, rpe: null, startedAt: "" });
  it("adds load at the top of the range, resets reps", () =>
    expect(nextLoad(prev(100, 12), 8, 12, 1.0, 2.5)).toEqual({ load: 102.5, reps: 8 }));
  it("adds a rep below the top (holds load)", () =>
    expect(nextLoad(prev(100, 8), 8, 12, 1.0, 2.5)).toEqual({ load: 100, reps: 9 }));
  it("holds load in a deficit even at the top", () =>
    expect(nextLoad(prev(100, 12), 8, 12, 0.1, 2.5)).toEqual({ load: 100, reps: 8 }));
  it("no history → null load at the bottom of the range", () =>
    expect(nextLoad(null, 8, 12, 1.0, 2.5)).toEqual({ load: null, reps: 8 }));
});

describe("rirWave", () => {
  it("ramps 3→0 across accumulation, deload easy", () => {
    expect([1, 2, 3, 4].map((w) => rirWave(w, 4, 0))).toEqual([3, 2, 1, 0]);
    expect(rirWave(5, 4, 0)).toBe(3);    // deload week
  });
  it("a deficit floors RIR at 1 (never grinds)", () => {
    expect(rirWave(4, 4, 1)).toBe(1);    // would be 0, floored to 1
  });
});

describe("readiness", () => {
  const NOW = new Date("2026-03-10T00:00:00Z").getTime();
  const CHEST: Muscle = "CHEST";
  it("trims when the muscle was reported sore within the window", () => {
    const data = [wk("1", "2026-03-09T00:00:00Z", [set({ reps: 8 })], { soreMuscles: ["CHEST"] })];
    expect(readiness(data, "x", CHEST, 8, NOW)).toMatchObject({ trim: true, reason: "recently sore" });
  });
  it("ignores a stale soreness report (outside the window)", () => {
    const data = [wk("1", "2026-03-01T00:00:00Z", [set({ reps: 8 })], { soreMuscles: ["CHEST"] })];
    expect(readiness(data, "x", CHEST, 8, NOW).trim).toBe(false);
  });
  it("trims when the last session fell short of target reps", () => {
    const data = [wk("1", "2026-03-09T00:00:00Z", [set({ weight: "100", reps: 5 })])];
    expect(readiness(data, "x", CHEST, 8, NOW)).toMatchObject({ trim: true, reason: "last session fell short" });
  });
  it("no trim when recovered (hit target, not sore)", () => {
    const data = [wk("1", "2026-03-09T00:00:00Z", [set({ weight: "100", reps: 8 })])];
    expect(readiness(data, "x", CHEST, 8, NOW).trim).toBe(false);
  });
});
