import { describe, it, expect } from "vitest";
import { summarizePlan } from "./planSummary";
import { e1rm } from "./prescription";
import type { BodyweightEntryDto, ExerciseDto, MacrocycleDto, MesocycleDto, SetDto, WorkoutDto } from "./api/types";

// ── minimal fixture helpers ──────────────────────────────────────────────────

const meso = (accumulationWeeks = 4): MesocycleDto => ({
  name: "Hypertrophy 1", accumulationWeeks, phase: "ACCUMULATION",
  focusMuscles: [], blockType: "HYPERTROPHY", intensityBand: null,
});

const plan = (over: Partial<MacrocycleDto> = {}): MacrocycleDto => ({
  id: "p1", name: "Test Plan", startedAt: "2026-01-05", status: "COMPLETED",
  mesoIndex: 0, week: 1, mesocycles: [meso(4)],
  goal: null, targetDate: null, focusMuscles: null,
  completedAt: "2026-02-09", endedAt: null,
  ...over,
});

const makeSet = (over: Partial<SetDto> = {}): SetDto => ({
  id: "s1", orderIndex: 0, setType: "WORKING", weight: "100", loadMode: null, loadDelta: null,
  weightUnit: "kg", reps: 8, rpe: null, note: null, estimated: null, kind: "STRENGTH",
  distanceM: null, durationS: null, gradePct: null, elevationGainM: null, cadenceSpm: null,
  ...over,
});

const workout = (
  id: string,
  startedAt: string,
  sets: SetDto[],
  over: Partial<WorkoutDto> = {},
): WorkoutDto => ({
  id, startedAt, durationSeconds: null, rawDurationText: null, templateId: null,
  cyclePhase: null,
  exercises: [{ exerciseId: "squat", name: "Squat", position: 0, note: null, sets }],
  soreMuscles: null, createdAt: "", updatedAt: "",
  ...over,
});

const bw = (recordedAt: string, weightKg: string): BodyweightEntryDto => ({
  id: "b1", recordedAt, weightKg, estimated: false,
});

const noExercises: ExerciseDto[] = [];

// ── tests ────────────────────────────────────────────────────────────────────

describe("summarizePlan — structural stats (weeks / blocks)", () => {
  it("sums accumulationWeeks+1 per meso for total weeks", () => {
    const p = plan({ mesocycles: [meso(4), meso(3)] });
    const result = summarizePlan(p, [], noExercises, []);
    expect(result.weeks).toBe(5 + 4);  // (4+1) + (3+1)
    expect(result.blocks).toBe(2);
  });

  it("single meso with 4 accumulation weeks → 5 weeks, 1 block", () => {
    const result = summarizePlan(plan(), [], noExercises, []);
    expect(result.weeks).toBe(5);
    expect(result.blocks).toBe(1);
  });
});

describe("summarizePlan — zero-workout plan", () => {
  it("all counts are zero / empty / null with no workouts", () => {
    const result = summarizePlan(plan(), [], noExercises, []);
    expect(result.sessions).toBe(0);
    expect(result.hardSets).toBe(0);
    expect(result.deloads).toBe(0);
    expect(result.strengthGains).toEqual([]);
    expect(result.bodyweightDeltaKg).toBeNull();
    // No NaN
    expect(Number.isNaN(result.weeks)).toBe(false);
    expect(Number.isNaN(result.blocks)).toBe(false);
  });
});

describe("summarizePlan — happy path with progressive overload", () => {
  // Two non-deload sessions: Squat goes from 100 kg × 8 to 120 kg × 8.
  // e1rm(100, 8) = 100*(1+8/30) ≈ 126.67 (Epley)
  // e1rm(120, 8) = 120*(1+8/30) ≈ 152    (Epley)
  // pct = round((152 - 126.67) / 126.67 * 100) = round(20) = 20 (approximately)
  const s1 = makeSet({ weight: "100", reps: 8 });
  const s2 = makeSet({ weight: "120", reps: 8 });
  const w1 = workout("w1", "2026-01-10", [s1]);
  const w2 = workout("w2", "2026-01-20", [s2]);
  const p = plan({ completedAt: "2026-02-09" });

  it("counts sessions and hardSets", () => {
    const result = summarizePlan(p, [w1, w2], noExercises, []);
    expect(result.sessions).toBe(2);
    expect(result.hardSets).toBe(2);  // one WORKING set per session
  });

  it("reports a strength gain for Squat with a known pct", () => {
    const result = summarizePlan(p, [w1, w2], noExercises, []);
    expect(result.strengthGains).toHaveLength(1);
    const gain = result.strengthGains[0];
    expect(gain.exerciseName).toBe("Squat");

    const expectedFrom = Math.round(e1rm(100, 8) * 10) / 10;
    const expectedTo = Math.round(e1rm(120, 8) * 10) / 10;
    const expectedPct = Math.round((e1rm(120, 8) - e1rm(100, 8)) / e1rm(100, 8) * 100);

    expect(gain.fromKg).toBeCloseTo(expectedFrom, 0);
    expect(gain.toKg).toBeCloseTo(expectedTo, 0);
    expect(gain.pct).toBe(expectedPct);
  });

  it("sorts by pct descending, top 5 only", () => {
    // Build 6 exercises with varying gains; the 6th should be dropped
    const makeExerciseWorkout = (
      id: string,
      startedAt: string,
      exerciseName: string,
      weightStr: string,
    ): WorkoutDto => ({
      id, startedAt, durationSeconds: null, rawDurationText: null, templateId: null,
      cyclePhase: null,
      exercises: [{ exerciseId: id, name: exerciseName, position: 0, note: null,
        sets: [makeSet({ weight: weightStr, reps: 8 })] }],
      soreMuscles: null, createdAt: "", updatedAt: "",
    });
    const exercises = ["A", "B", "C", "D", "E", "F"];
    const weights1 = ["100", "100", "100", "100", "100", "100"];
    const weights2 = ["160", "150", "140", "130", "120", "110"]; // gains: 60%, 50%, 40%, 30%, 20%, 10%
    const wks = exercises.flatMap((name, i) => [
      makeExerciseWorkout(`first-${name}`, "2026-01-10", name, weights1[i]),
      makeExerciseWorkout(`last-${name}`, "2026-01-20", name, weights2[i]),
    ]);
    const result = summarizePlan(p, wks, noExercises, []);
    expect(result.strengthGains).toHaveLength(5);
    // Top should be A with ~60% gain (computed), bottom should be E with ~20%
    expect(result.strengthGains[0].exerciseName).toBe("A");
    expect(result.strengthGains[4].exerciseName).toBe("E");
    // F (lowest gain) should be excluded
    expect(result.strengthGains.find((g) => g.exerciseName === "F")).toBeUndefined();
  });
});

describe("summarizePlan — deload sessions", () => {
  const workingSet = makeSet({ weight: "100", reps: 8 });
  const wWorking1 = workout("w1", "2026-01-10", [workingSet]);
  const wWorking2 = workout("w2", "2026-01-20", [makeSet({ weight: "110", reps: 8 })]);
  const wDeload = workout("w3", "2026-01-17", [makeSet({ weight: "60", reps: 12 })], { cyclePhase: "DELOAD" });

  it("counts deload sessions in deloads and sessions, but not hardSets", () => {
    const p = plan({ completedAt: "2026-02-09" });
    const result = summarizePlan(p, [wWorking1, wDeload, wWorking2], noExercises, []);
    expect(result.sessions).toBe(3);       // all 3 in window
    expect(result.deloads).toBe(1);        // only the deload
    expect(result.hardSets).toBe(2);       // deload's set is excluded
  });

  it("excludes deload sessions from strengthGains", () => {
    // Only one non-deload session → no gain (need ≥2 non-deload)
    const p = plan({ completedAt: "2026-02-09" });
    const result = summarizePlan(p, [wWorking1, wDeload], noExercises, []);
    expect(result.strengthGains).toHaveLength(0);  // only 1 non-deload session
  });

  it("includes deload session in strengthGains baseline only if 2+ non-deload exist", () => {
    // With 2 non-deload sessions the gain computes from w1 → w2, ignoring the deload
    const p = plan({ completedAt: "2026-02-09" });
    const result = summarizePlan(p, [wWorking1, wDeload, wWorking2], noExercises, []);
    expect(result.strengthGains).toHaveLength(1);
    // fromKg is based on wWorking1 (100 kg), toKg based on wWorking2 (110 kg)
    expect(result.strengthGains[0].fromKg).toBeCloseTo(Math.round(e1rm(100, 8) * 10) / 10, 0);
    expect(result.strengthGains[0].toKg).toBeCloseTo(Math.round(e1rm(110, 8) * 10) / 10, 0);
  });
});

describe("summarizePlan — workout outside window is excluded", () => {
  it("workout before plan.startedAt is not counted", () => {
    const p = plan({ startedAt: "2026-01-05", completedAt: "2026-02-09" });
    const outsideWorkout = workout("w-before", "2026-01-04", [makeSet()]);
    const insideWorkout = workout("w-inside", "2026-01-10", [makeSet()]);
    const result = summarizePlan(p, [outsideWorkout, insideWorkout], noExercises, []);
    expect(result.sessions).toBe(1);
    expect(result.hardSets).toBe(1);
  });

  it("workout after plan.completedAt is not counted", () => {
    const p = plan({ startedAt: "2026-01-05", completedAt: "2026-02-09" });
    const afterWorkout = workout("w-after", "2026-02-10", [makeSet()]);
    const insideWorkout = workout("w-inside", "2026-01-10", [makeSet()]);
    const result = summarizePlan(p, [afterWorkout, insideWorkout], noExercises, []);
    expect(result.sessions).toBe(1);
  });

  it("open-ended plan (no completedAt/endedAt) includes all future workouts", () => {
    const p = plan({ completedAt: null, endedAt: null, status: "ACTIVE" });
    const farFuture = workout("wf", "2099-12-31", [makeSet()]);
    const result = summarizePlan(p, [farFuture], noExercises, []);
    expect(result.sessions).toBe(1);
  });
});

describe("summarizePlan — bodyweight delta", () => {
  it("returns null with fewer than 2 in-window weigh-ins", () => {
    const p = plan();
    const result = summarizePlan(p, [], noExercises, [bw("2026-01-10", "80")]);
    expect(result.bodyweightDeltaKg).toBeNull();
  });

  it("returns null with zero weigh-ins", () => {
    expect(summarizePlan(plan(), [], noExercises, []).bodyweightDeltaKg).toBeNull();
  });

  it("computes last minus first weigh-in within window", () => {
    const p = plan({ startedAt: "2026-01-05", completedAt: "2026-02-09" });
    const weighIns = [
      bw("2026-01-10", "80.0"),
      bw("2026-01-20", "80.5"),
      bw("2026-02-05", "82.0"),
    ];
    const result = summarizePlan(p, [], noExercises, weighIns);
    expect(result.bodyweightDeltaKg).toBeCloseTo(2.0, 1);  // 82.0 - 80.0
  });

  it("excludes weigh-ins outside the plan window", () => {
    const p = plan({ startedAt: "2026-01-05", completedAt: "2026-02-09" });
    const weighIns = [
      bw("2026-01-01", "75.0"),  // before window — excluded
      bw("2026-01-15", "80.0"),
      bw("2026-02-01", "82.0"),
      bw("2026-02-20", "85.0"),  // after window — excluded
    ];
    const result = summarizePlan(p, [], noExercises, weighIns);
    expect(result.bodyweightDeltaKg).toBeCloseTo(2.0, 1);  // 82.0 - 80.0
  });

  it("weightKg is a string — parses correctly without float drift", () => {
    const p = plan();
    const result = summarizePlan(p, [], noExercises, [
      bw("2026-01-10", "79.25"),
      bw("2026-02-05", "80.75"),
    ]);
    expect(result.bodyweightDeltaKg).toBeCloseTo(1.5, 1);
  });
});

describe("summarizePlan — e1RM uses WORKING set, not warmup", () => {
  it("warmup sets are ignored in strength gain calculation", () => {
    const warmupSet = makeSet({ setType: "WARMUP", weight: "200", reps: 1 });
    const workingSetA = makeSet({ setType: "WORKING", weight: "80", reps: 8 });
    const workingSetB = makeSet({ setType: "WORKING", weight: "100", reps: 8 });

    const w1: WorkoutDto = {
      id: "w1", startedAt: "2026-01-10", durationSeconds: null, rawDurationText: null,
      templateId: null, cyclePhase: null,
      exercises: [{ exerciseId: "squat", name: "Squat", position: 0, note: null,
        sets: [warmupSet, workingSetA] }],
      soreMuscles: null, createdAt: "", updatedAt: "",
    };
    const w2: WorkoutDto = {
      id: "w2", startedAt: "2026-01-20", durationSeconds: null, rawDurationText: null,
      templateId: null, cyclePhase: null,
      exercises: [{ exerciseId: "squat", name: "Squat", position: 0, note: null,
        sets: [warmupSet, workingSetB] }],
      soreMuscles: null, createdAt: "", updatedAt: "",
    };

    const result = summarizePlan(plan(), [w1, w2], noExercises, []);
    expect(result.strengthGains).toHaveLength(1);
    const gain = result.strengthGains[0];
    // fromKg should be based on 80 kg working set, NOT the 200 kg warmup
    expect(gain.fromKg).toBeCloseTo(Math.round(e1rm(80, 8) * 10) / 10, 0);
    expect(gain.toKg).toBeCloseTo(Math.round(e1rm(100, 8) * 10) / 10, 0);
  });
});

describe("summarizePlan — endedAt fallback", () => {
  it("uses completedAt when present", () => {
    const p = plan({ completedAt: "2026-02-09", endedAt: null });
    const result = summarizePlan(p, [], noExercises, []);
    expect(result.endedAt).toBe("2026-02-09");
  });

  it("uses endedAt when completedAt is absent", () => {
    const p = plan({ completedAt: null, endedAt: "2026-02-15" });
    const result = summarizePlan(p, [], noExercises, []);
    expect(result.endedAt).toBe("2026-02-15");
  });

  it("falls back to latest in-window workout date when both are null", () => {
    const p = plan({ completedAt: null, endedAt: null, status: "ACTIVE" });
    const w1 = workout("w1", "2026-01-10", [makeSet()]);
    const w2 = workout("w2", "2026-02-01", [makeSet()]);
    const result = summarizePlan(p, [w1, w2], noExercises, []);
    expect(result.endedAt).toBe("2026-02-01");
  });

  it("falls back to startedAt when no workouts and both timestamps null", () => {
    const p = plan({ startedAt: "2026-01-05", completedAt: null, endedAt: null });
    const result = summarizePlan(p, [], noExercises, []);
    expect(result.endedAt).toBe("2026-01-05");
  });
});
