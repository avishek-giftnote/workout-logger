import { describe, it, expect } from "vitest";
import { realWeightSeries } from "./bodyweight";
import type { BodyweightEntryDto } from "./api/types";

const e = (recordedAt: string, weightKg: string | null, estimated = false): BodyweightEntryDto =>
  ({ id: recordedAt, recordedAt, weightKg, estimated });

describe("realWeightSeries", () => {
  it("orders points oldest→newest regardless of input (insertion) order", () => {
    // mirrors the real bug: an import-baseline entry inserted first but dated mid-range
    const log = [
      e("2026-06-16T07:00:00Z", "59.4"),   // baseline, inserted first
      e("2026-05-25T07:00:00Z", "59.5"),
      e("2026-06-23T07:00:00Z", "59.6"),
    ];
    const s = realWeightSeries(log);
    expect(s.map((p) => p.label)).toEqual([
      "2026-05-25T07:00:00Z", "2026-06-16T07:00:00Z", "2026-06-23T07:00:00Z",
    ]);
    expect(s.map((p) => p.value)).toEqual([59.5, 59.4, 59.6]);
  });

  it("excludes estimated and null-weight entries", () => {
    const log = [e("2026-06-01", "75", true), e("2026-06-02", null), e("2026-06-03", "60")];
    expect(realWeightSeries(log)).toEqual([{ label: "2026-06-03", value: 60 }]);
  });

  it("does not mutate the input array", () => {
    const log = [e("b", "2"), e("a", "1")];
    realWeightSeries(log);
    expect(log.map((x) => x.recordedAt)).toEqual(["b", "a"]);
  });
});
