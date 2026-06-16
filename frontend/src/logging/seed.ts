/**
 * Pure seeding helpers for the logging screen, extracted from LogWorkoutPage so they can be swept by
 * the logging eval (logging.eval.test.ts). LogWorkoutPage held these as closures over TanStack queries,
 * which made them untestable. Keep these PURE (params in, value out) — see docs/coach.md and the
 * "pure fn + eval" pattern used by periodization.ts / prescription.ts.
 */
import type { SetDto, WorkoutDto } from "../api/types";
import type { PrevSource } from "../settings";
import type { DraftBlock } from "./engine";

/**
 * The previous sets to seed placeholders from for an exercise. Returns the most-recent session's sets
 * (sorted newest-first explicitly — don't trust the query order). With prevSource "template" and an
 * active template, only sessions of that template are considered. Null when there's no history.
 */
export function pickPrevSets(
  workouts: WorkoutDto[], exerciseId: string, prevSource: PrevSource, templateId: string | null,
): SetDto[] | null {
  const ordered = [...workouts].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const w of ordered) {
    if (prevSource === "template" && templateId && w.templateId !== templateId) continue;
    const b = w.exercises.find((e) => e.exerciseId === exerciseId);
    if (b) return b.sets;
  }
  return null;
}

/** Only completed sets are saved; an exercise with no completed set is dropped entirely. */
export const finishedBlocks = (blocks: DraftBlock[]): DraftBlock[] =>
  blocks.map((b) => ({ ...b, sets: b.sets.filter((s) => s.done) })).filter((b) => b.sets.length > 0);

/**
 * Ease an under-recovered seed: drop exactly one set (never below 1) and lower each seeded RPE by one
 * (floored at 1). A no-op when not trimming or there's nothing to trim.
 */
export function applyEase(base: SetDto[] | null, trim: boolean): SetDto[] | null {
  if (!base || !base.length || !trim) return base;
  return base
    .slice(0, Math.max(1, base.length - 1))
    .map((s) => ({ ...s, rpe: s.rpe != null ? Math.max(1, s.rpe - 1) : s.rpe }));
}
