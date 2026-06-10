import { describe, it, expect } from "vitest";
import { blankSet, mmssToSec, paceSpeed, toCreateSet, structureChanged, type DraftSet } from "./engine";
import type { ExerciseDto, TemplateDto } from "../api/types";

const set = (o: Partial<DraftSet>): DraftSet => ({ ...blankSet("WORKING"), ...o });

describe("mmssToSec", () => {
  it("parses mm:ss", () => expect(mmssToSec("26:14")).toBe(1574));
  it("treats a bare number as minutes", () => expect(mmssToSec("5")).toBe(300));
  it("blank → null", () => expect(mmssToSec("")).toBeNull());
});

describe("paceSpeed", () => {
  it("derives pace (/km) and speed (km/h)", () =>
    expect(paceSpeed(10, 3000)).toEqual({ pace: "5:00 /km", speed: "12.0 km/h" }));
  it("guards against zero distance/time", () => {
    expect(paceSpeed(0, 100)).toBeNull();
    expect(paceSpeed(5, 0)).toBeNull();
  });
});

describe("toCreateSet", () => {
  it("maps a strength set", () => {
    expect(toCreateSet(set({ weight: "60", reps: "5", rpe: "8" }), 0, false, "", true, false))
      .toEqual({ orderIndex: 0, setType: "WORKING", kind: "STRENGTH", weight: "60", loadMode: null, loadDelta: null, reps: 5, rpe: 8 });
  });
  it("omits RPE when the field is hidden", () =>
    expect(toCreateSet(set({ weight: "60", reps: "5", rpe: "8" }), 0, false, "", false, false).rpe).toBeNull());
  it("computes cumulative bodyweight load", () => {
    const r = toCreateSet(set({ delta: "10", mode: "ADDED", reps: "8" }), 0, true, "72.5", true, false);
    expect(r.weight).toBe("82.5");
    expect(r.loadMode).toBe("ADDED");
    expect(r.loadDelta).toBe("10");
  });
  it("subtracts assistance for assisted bodyweight", () => {
    const r = toCreateSet(set({ delta: "20", mode: "ASSISTED", reps: "6" }), 0, true, "72.5", true, false);
    expect(r.weight).toBe("52.5");
    expect(r.loadMode).toBe("ASSISTED");
  });
  it("maps a cardio set with no float drift on distance", () => {
    const r = toCreateSet(set({ distance: "5.2", time: "26:14" }), 0, false, "", true, true);
    expect(r).toMatchObject({ kind: "CARDIO", distanceM: "5200", durationS: 1574, weight: null, reps: null });
  });
});

describe("structureChanged", () => {
  const tmpl = (sets: number): TemplateDto =>
    ({ id: "t", name: "T", exercises: [{ exerciseId: "x", name: "X", position: 0, sets }], createdAt: "", updatedAt: "" }) as unknown as TemplateDto;
  const block = (sets: number) =>
    ({ key: "k", exercise: { id: "x" } as ExerciseDto, sets: Array.from({ length: sets }, () => blankSet("WORKING")) });

  it("returns false when the shape matches the template", () => expect(structureChanged(tmpl(3), [block(3)])).toBe(false));
  it("returns true when a set count changed", () => expect(structureChanged(tmpl(3), [block(4)])).toBe(true));
  it("returns true when an exercise was added", () =>
    expect(structureChanged(tmpl(3), [block(3), block(3)])).toBe(true));
});
