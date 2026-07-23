import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createSet, DECIMAL_PATTERN, logWorkoutShape, setBodyweightShape } from "./schemas.js";

// Guard-first: the whole point of the decimal-STRING invariant is that a JS number can never
// reach the wire (it would silently round the ~0.25 kg fractional plates). These pin it.
describe("decimal weight guard", () => {
  const weight = z.object(setBodyweightShape).shape.weightKg;

  it("accepts decimal strings within range", () => {
    for (const v of ["82.5", "100", "0", "9999", "82.125", "-5"]) {
      expect(weight.safeParse(v).success).toBe(true);
    }
  });

  it("rejects a JS number (the actual bug this prevents)", () => {
    expect(weight.safeParse(82.5 as unknown).success).toBe(false);
  });

  it("rejects out-of-range / malformed strings", () => {
    for (const v of ["10000", "82.5kg", "", "1.2345", "abc", "8,5"]) {
      expect(weight.safeParse(v).success).toBe(false);
    }
  });

  it("mirrors the backend DECIMAL_PATTERN exactly", () => {
    expect(DECIMAL_PATTERN.source).toBe("^-?\\d{1,4}(\\.\\d{1,3})?$");
  });
});

describe("createSet", () => {
  it("accepts a well-formed working set with string weight", () => {
    const r = createSet.safeParse({ orderIndex: 0, setType: "WORKING", weight: "80", reps: 5, rpe: 8 });
    expect(r.success).toBe(true);
  });

  it("rejects reps and rpe out of bounds", () => {
    expect(createSet.safeParse({ orderIndex: 0, setType: "WORKING", reps: 2000 }).success).toBe(false);
    expect(createSet.safeParse({ orderIndex: 0, setType: "WORKING", rpe: 11 }).success).toBe(false);
  });

  it("rejects a numeric weight", () => {
    expect(createSet.safeParse({ orderIndex: 0, setType: "WORKING", weight: 80 }).success).toBe(false);
  });
});

describe("logWorkoutShape", () => {
  const schema = z.object(logWorkoutShape);
  it("requires startedAt and exercises", () => {
    expect(schema.safeParse({}).success).toBe(false);
    const ok = schema.safeParse({
      startedAt: "2026-07-21T18:30:00Z",
      exercises: [{ exerciseId: "e1", position: 0, sets: [{ orderIndex: 0, setType: "WORKING", weight: "80", reps: 5 }] }],
    });
    expect(ok.success).toBe(true);
  });
});
