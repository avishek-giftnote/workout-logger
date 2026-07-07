import { describe, it, expect } from "vitest";
import { blankSet, cardioSummary, fmtTime, formatSetLabel, isLargeJump, mmssToSec, paceSpeed, serializeDraft, deserializeDraft, toCreateSet, structureChanged, uid, type DraftSet } from "./engine";
import type { ExerciseDto, SetDto, TemplateDto, WorkoutDto } from "../api/types";

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
  it("rounds grade/elev to the backend pattern precision so free-text can't 400", () => {
    // grade → 2dp, elev → 3dp (mirrors the CARDIO_GRADE/ELEVATION patterns); "12.555" must not reach the server
    const r = toCreateSet(set({ distance: "5", time: "25:00", grade: "12.555", elev: "52.5555" }), 0, false, "", true, true);
    expect(r.gradePct).toBe("12.56");
    expect(r.elevationGainM).toBe("52.556");
  });
});

describe("isLargeJump", () => {
  it("returns false when no placeholder", () => expect(isLargeJump("200", undefined)).toBe(false));
  it("returns false when entry is blank", () => expect(isLargeJump("", "100")).toBe(false));
  it("returns false when entry equals placeholder", () => expect(isLargeJump("100", "100")).toBe(false));
  it("returns false for a normal progression (< 1.5×)", () => expect(isLargeJump("110", "100")).toBe(false));
  it("returns true when entry is > 1.5× the placeholder", () => expect(isLargeJump("160", "100")).toBe(true));
  it("returns true for a > 50 kg absolute jump", () => expect(isLargeJump("160", "105")).toBe(true));
  it("returns false for a 50 kg absolute jump that is not > 1.5×", () => {
    // 200 → 250: +50 absolute but 250/200 = 1.25 — neither threshold fires
    expect(isLargeJump("250", "200")).toBe(false);
  });
  it("returns true when a typo inflates by 10× (e.g. 1000 vs 100)", () => expect(isLargeJump("1000", "100")).toBe(true));
  it("handles non-numeric entry gracefully", () => expect(isLargeJump("abc", "100")).toBe(false));
});

describe("serializeDraft / deserializeDraft round-trip", () => {
  const makeDraft = () => ({
    savedAt: 1700000000000,
    templateId: "tmpl-1",
    deload: false,
    blocks: [
      {
        key: uid(),
        exercise: { id: "ex-1", name: "Squat", isBodyweight: false, equipment: "BARBELL" as const,
          category: "STRENGTH" as const, defaultUnit: "kg" as const, restSeconds: null,
          cardioMetrics: null, muscleContributions: [], laterality: null, mechanic: null, loadable: null },
        sets: [{ ...blankSet("WORKING"), weight: "100", reps: "5" }],
      },
    ],
  });

  it("round-trips a draft unchanged", () => {
    const d = makeDraft();
    const restored = deserializeDraft(serializeDraft(d));
    expect(restored).not.toBeNull();
    expect(restored!.templateId).toBe("tmpl-1");
    expect(restored!.deload).toBe(false);
    expect(restored!.blocks).toHaveLength(1);
    expect(restored!.blocks[0].sets[0].weight).toBe("100");
  });
  it("returns null for null input", () => expect(deserializeDraft(null)).toBeNull());
  it("returns null for malformed JSON", () => expect(deserializeDraft("not-json{")).toBeNull());
  it("returns null when blocks array is missing", () =>
    expect(deserializeDraft(JSON.stringify({ savedAt: 1, templateId: null, deload: false }))).toBeNull());
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

// ── cardio display helpers (shared by WorkoutDetailPage + ExerciseDetailPage) ──
const sd = (o: Partial<SetDto>): SetDto => ({
  id: "s", setType: "WORKING", weight: null, loadMode: null, loadDelta: null, reps: null, rpe: null,
  note: null, kind: null, distanceM: null, durationS: null, gradePct: null, elevationGainM: null, cadenceSpm: null, ...o,
} as SetDto);

describe("fmtTime", () => {
  it("mm:ss under an hour", () => expect(fmtTime(1574)).toBe("26:14"));
  it("rolls hours over past 60 min (the bug: 5400 was '90:00')", () => expect(fmtTime(5400)).toBe("1:30:00"));
  it("pads minutes+seconds in the H:MM:SS form", () => expect(fmtTime(3661)).toBe("1:01:01"));
  it("zero → 0:00", () => expect(fmtTime(0)).toBe("0:00"));
});

describe("formatSetLabel", () => {
  it("cardio distance + duration + derived pace", () =>
    expect(formatSetLabel(sd({ kind: "CARDIO", distanceM: "5200", durationS: 1574 }))).toBe("5.20 km · 26:14 · 5:03 /km"));
  it("cardio distance only (no pace without duration)", () =>
    expect(formatSetLabel(sd({ kind: "CARDIO", distanceM: "5200" }))).toBe("5.20 km"));
  it("cardio duration only, over an hour", () =>
    expect(formatSetLabel(sd({ kind: "CARDIO", durationS: 5400 }))).toBe("1:30:00"));
  it("cardio with neither distance nor duration → —", () =>
    expect(formatSetLabel(sd({ kind: "CARDIO" }))).toBe("—"));
  it("strength unchanged (bodyweight ADDED decomposition)", () =>
    expect(formatSetLabel(sd({ loadMode: "ADDED", weight: "82.5", loadDelta: "10" }))).toBe("82.5 kg · BW +10"));
  it("plain strength weight", () => expect(formatSetLabel(sd({ weight: "60" }))).toBe("60 kg"));
});

describe("cardioSummary", () => {
  const w = (sets: Partial<SetDto>[]): WorkoutDto => ({
    id: "w", startedAt: "2026-06-04T07:00:00Z", durationSeconds: null, rawDurationText: null, templateId: null,
    cyclePhase: null, soreMuscles: null, createdAt: "", updatedAt: "", version: 1,
    exercises: [{ exerciseId: "e", name: "x", position: 0, note: null, sets: sets.map(sd) }],
  } as WorkoutDto);
  it("strength-only → no cardio, no distance", () =>
    expect(cardioSummary(w([{ weight: "60", reps: 5 }]))).toMatchObject({ hasCardio: false, hasStrength: true, km: 0 }));
  it("cardio-only → distance summed, no strength", () =>
    expect(cardioSummary(w([{ kind: "CARDIO", distanceM: "5200" }, { kind: "CARDIO", distanceM: "4800" }])))
      .toMatchObject({ hasCardio: true, hasStrength: false, km: 10 }));
  it("mixed → both flags true, only cardio distance counted", () =>
    expect(cardioSummary(w([{ weight: "60", reps: 5 }, { kind: "CARDIO", distanceM: "3000" }])))
      .toMatchObject({ hasCardio: true, hasStrength: true, km: 3 }));
  it("cardio with no distance → hasCardio true, km 0, no NaN", () => {
    const r = cardioSummary(w([{ kind: "CARDIO", durationS: 600 }]));
    expect(r.hasCardio).toBe(true);
    expect(r.km).toBe(0);
  });
});
