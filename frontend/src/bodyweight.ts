import type { BodyweightEntryDto } from "./api/types";

export interface TrendPoint { label: string; value: number; }

/**
 * Real (non-estimated) weigh-ins as chart points, sorted oldest→newest by recordedAt so the trend reads
 * left→right on the x-axis. TrendChart plots points in array order, so the series MUST be pre-sorted here —
 * the raw bodyweightLog is in insertion order (e.g. the import baseline first), which is not chronological.
 */
export function realWeightSeries(log: BodyweightEntryDto[]): TrendPoint[] {
  return log
    .filter((e) => !e.estimated && e.weightKg)
    .slice()
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((e) => ({ label: e.recordedAt, value: parseFloat(e.weightKg!) }));
}
