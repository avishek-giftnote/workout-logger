/**
 * LOGGING EVAL HARNESS — not a unit test, an eval.
 *
 * Sweeps the pure logging path (placeholder seeding → live entry → API serialization, plus the extracted
 * prevSource / finished-blocks / readiness-ease helpers) across exercise kinds, previous-set shapes, and
 * bodyweight values, and SCORES the research/wire invariants the council ratified (L1–L13). The point is
 * to catch silent regressions — float drift into Decimal128, a lost loadMode, a placeholder that stops
 * coalescing — across the whole input space, not just the few hand-picked points engine.test.ts samples.
 *
 * Run with:  npm run eval   (kept OUT of the default `npm test` gate — an eval is a measurement you run).
 */
import { describe, it, expect } from "vitest";
import {
  blankSet, filledSet, mmssToSec, paceSpeed, parseRest, secToMmss, seededSet, structureChanged,
  toCreateSet, type DraftBlock, type DraftSet,
} from "./engine";
import { applyEase, finishedBlocks, pickPrevSets } from "./seed";
import type { ExerciseDto, SetDto, WorkoutDto } from "../api/types";

// ── fixtures ──
const set = (p: Partial<SetDto>): SetDto => ({
  id: "s", orderIndex: 0, setType: "WORKING", weight: null, loadMode: null, loadDelta: null,
  weightUnit: "kg", reps: null, rpe: null, note: null, estimated: null, kind: "STRENGTH",
  distanceM: null, durationS: null, gradePct: null, elevationGainM: null, cadenceSpm: null, ...p,
});
const workout = (p: Partial<WorkoutDto> & { exId: string; sets: SetDto[] }): WorkoutDto => ({
  id: "w" + Math.round(Math.random() * 1e9), startedAt: "2026-01-01T00:00:00Z", durationSeconds: null,
  rawDurationText: null, templateId: null, cyclePhase: null, soreMuscles: null,
  createdAt: "", updatedAt: "",
  exercises: [{ exerciseId: p.exId, name: "x", position: 0, note: null, sets: p.sets }], ...p,
});
const bwSet = (mode: "ADDED" | "ASSISTED", delta: string): DraftSet =>
  ({ ...blankSet(), mode, delta });

// the decimal part of a numeric string, "" if integer — used to detect binary-float drift tails
const frac = (s: string) => (s.includes(".") ? s.split(".")[1] : "");

// ── the sweep ──
const BODYWEIGHTS = ["72.3", "85.7", "90", "0.1", "68.45", "100.125"];
const DELTAS = ["0", "10.1", "0.1", "2.5", "20", "5.25"];
const MODES: ("ADDED" | "ASSISTED")[] = ["ADDED", "ASSISTED"];
const EXT_WEIGHTS = ["62.5", "100.25", "0.0001", "42", "137.75"];

interface Violation { rule: string; detail: string; }

function evaluate(): Violation[] {
  const v: Violation[] = [];
  const fail = (rule: string, detail: string) => v.push({ rule, detail });

  // L1/L2/L3 — bodyweight cumulative-load: no float drift, correct decomposition, NaN-guarded
  for (const bw of BODYWEIGHTS) for (const delta of DELTAS) for (const mode of MODES) {
    const r = toCreateSet(bwSet(mode, delta), 0, true, bw);
    const w = r.weight ?? "NaN";
    const bwN = parseFloat(bw), d = parseFloat(delta);
    const expected = Math.round((mode === "ASSISTED" ? bwN - d : bwN + d) * 1e6) / 1e6;
    // L1 — exact to the grain, and no drifting mantissa tail
    if (w === "NaN") fail("L1-drift", `bw=${bw} d=${delta} ${mode} → NaN`);
    else if (Math.abs(parseFloat(w) - expected) > 1e-9)
      fail("L1-drift", `bw=${bw} d=${delta} ${mode} → ${w}, want ${expected}`);
    else if (frac(w).length > 6)
      fail("L1-drift", `bw=${bw} d=${delta} ${mode} → ${w} has a float-drift tail`);
    // L2 — loadMode is BODYWEIGHT exactly when delta==0; loadDelta is the unsigned magnitude
    const wantMode = d === 0 ? "BODYWEIGHT" : mode;
    if (r.loadMode !== wantMode) fail("L2-mode", `d=${delta} → loadMode ${r.loadMode}, want ${wantMode}`);
    if (r.loadDelta !== String(d)) fail("L2-delta", `delta=${delta} → loadDelta ${r.loadDelta}`);
  }
  // L3 — blank / non-numeric bodyweight must not serialize a "NaN" weight onto the wire
  for (const bw of ["", "abc", "  "]) {
    const r = toCreateSet(bwSet("ADDED", "5"), 0, true, bw);
    if (r.weight === "NaN" || !Number.isFinite(parseFloat(r.weight ?? "NaN")))
      fail("L3-nan-guard", `bw="${bw}" → weight ${r.weight}`);
  }

  // L4 — seededSet/filledSet round-trip a bodyweight set's loadMode+loadDelta losslessly back through toCreateSet
  for (const mode of MODES) for (const delta of ["0", "10.1", "5.25"]) {
    const prev = set({ loadMode: mode === "ASSISTED" ? "ASSISTED" : "ADDED", loadDelta: delta, reps: 8, rpe: 8 });
    for (const [label, draft] of [["seeded", seededSet(prev, true)], ["filled", filledSet(prev, true)]] as const) {
      const r = toCreateSet(draft, 0, true, "80");
      const wantMode = parseFloat(delta) === 0 ? "BODYWEIGHT" : mode;
      if (r.loadDelta !== String(parseFloat(delta))) fail("L4-roundtrip", `${label} ${mode} delta=${delta} → loadDelta ${r.loadDelta}`);
      if (r.loadMode !== wantMode) fail("L4-roundtrip", `${label} ${mode} delta=${delta} → loadMode ${r.loadMode}, want ${wantMode}`);
    }
  }

  // L5 — placeholder→live coalescing: a blank live field falls back to p*, a non-blank live entry wins
  {
    const ext = (over: Partial<DraftSet>): DraftSet => ({ ...blankSet(), ...over });
    // non-bw weight
    if (toCreateSet(ext({ weight: "", pWeight: "60" }), 0, false, "").weight !== "60") fail("L5-coalesce", "blank weight didn't fall back to pWeight");
    if (toCreateSet(ext({ weight: "70", pWeight: "60" }), 0, false, "").weight !== "70") fail("L5-coalesce", "live weight didn't win over pWeight");
    // reps
    if (toCreateSet(ext({ reps: "", pReps: "8" }), 0, false, "").reps !== 8) fail("L5-coalesce", "blank reps didn't fall back to pReps");
    if (toCreateSet(ext({ reps: "5", pReps: "8" }), 0, false, "").reps !== 5) fail("L5-coalesce", "live reps didn't win over pReps");
    // bodyweight delta
    if (toCreateSet(ext({ delta: "", pDelta: "10" }), 0, true, "80").loadDelta !== "10") fail("L5-coalesce", "blank delta didn't fall back to pDelta");
  }

  // L6 — external-load weight passes through as the verbatim string (no reparse / float drift)
  for (const w of EXT_WEIGHTS) {
    const r = toCreateSet({ ...blankSet(), weight: w }, 0, false, "");
    if (r.weight !== w) fail("L6-verbatim", `external weight ${w} → ${r.weight}`);
  }

  // L7 — cardio distance km→integer-metres with no drift; seededSet/filledSet recover the metres + duration
  for (const metres of ["5200", "5250", "5201", "10000", "421"]) for (const durS of [1574, 0, 3661]) {
    const prev = set({ kind: "CARDIO", distanceM: metres, durationS: durS });
    for (const [label, draft] of [["seeded", seededSet(prev, false)], ["filled", filledSet(prev, false)]] as const) {
      const r = toCreateSet(draft, 0, false, "", true, true);
      if (r.distanceM !== metres) fail("L7-cardio", `${label} ${metres}m → ${r.distanceM}`);
      if (r.distanceM != null && frac(r.distanceM).length > 0) fail("L7-cardio", `${label} ${metres}m → ${r.distanceM} not integer metres`);
      if (r.durationS !== durS) fail("L7-cardio", `${label} dur ${durS} → ${r.durationS}`);
    }
  }

  // L8 — duration unit divergence is pinned: mmssToSec(bare)=MINUTES, parseRest(bare)=SECONDS, secToMmss round-trips
  if (mmssToSec("90") !== 5400) fail("L8-units", `mmssToSec("90")=${mmssToSec("90")}, want 5400 (minutes)`);
  if (parseRest("90") !== 90) fail("L8-units", `parseRest("90")=${parseRest("90")}, want 90 (seconds)`);
  for (const s of [0, 59, 60, 90, 1574, 3661]) {
    if (mmssToSec(secToMmss(s)) !== s) fail("L8-units", `secToMmss/mmssToSec round-trip broke at ${s}`);
  }

  // L9 — paceSpeed is the exact inverse pair; null on non-positive distance or time
  {
    const r = paceSpeed(5, 1500);
    if (!r || r.pace !== "5:00 /km" || r.speed !== "12.0 km/h") fail("L9-pace", `paceSpeed(5,1500)=${JSON.stringify(r)}`);
    if (paceSpeed(0, 1500) !== null || paceSpeed(5, 0) !== null || paceSpeed(-1, 10) !== null) fail("L9-pace", "non-positive input not null");
  }

  // L10 — pickPrevSets: newest-first, and template scoping echoes only matching-template sessions
  {
    const ex = "EX";
    const older = workout({ exId: ex, templateId: "T1", startedAt: "2026-01-01T00:00:00Z", sets: [set({ reps: 5 })] });
    const newer = workout({ exId: ex, templateId: null, startedAt: "2026-03-01T00:00:00Z", sets: [set({ reps: 9 })] });
    const ws = [older, newer]; // deliberately oldest-first to prove the sort
    if (pickPrevSets(ws, ex, "any", null)?.[0].reps !== 9) fail("L10-prev", "any didn't return the newest session");
    if (pickPrevSets(ws, ex, "template", "T1")?.[0].reps !== 5) fail("L10-prev", "template scope didn't return the T1 session");
    if (pickPrevSets(ws, ex, "template", "T2") !== null) fail("L10-prev", "template scope leaked a non-matching session");
    if (pickPrevSets(ws, "MISSING", "any", null) !== null) fail("L10-prev", "no-history didn't return null");
  }

  // L11 — finishedBlocks persists only done sets and drops blocks left with none
  {
    const block = (key: string, dones: boolean[]): DraftBlock => ({
      key, exercise: { id: key } as ExerciseDto, sets: dones.map((d) => ({ ...blankSet(), done: d })),
    });
    const out = finishedBlocks([block("a", [true, false, true]), block("b", [false, false]), block("c", [true])]);
    if (out.length !== 2) fail("L11-finished", `kept ${out.length} blocks, want 2 (drop the all-undone one)`);
    if (out[0]?.sets.length !== 2) fail("L11-finished", `block a kept ${out[0]?.sets.length} sets, want 2 done`);
    if (out.some((b) => b.sets.some((s) => !s.done))) fail("L11-finished", "an undone set survived");
  }

  // L12 — applyEase drops exactly one set (floored at 1) and lowers each seeded rpe by 1 (floored at 1)
  {
    const base = [set({ rpe: 8 }), set({ rpe: 8 }), set({ rpe: 8 })];
    const eased = applyEase(base, true)!;
    if (eased.length !== 2) fail("L12-ease", `trim kept ${eased.length} sets, want 2`);
    if (eased.some((s) => s.rpe !== 7)) fail("L12-ease", "rpe not lowered by 1");
    if (applyEase(base, false) !== base) fail("L12-ease", "no-trim should be a no-op");
    if (applyEase([set({ rpe: 1 })], true)!.length !== 1) fail("L12-ease", "single-set trim went below 1");
    if (applyEase([set({ rpe: 1 })], true)![0].rpe !== 1) fail("L12-ease", "rpe floor breached (went below 1)");
    if (applyEase(null, true) !== null) fail("L12-ease", "null base should stay null");
  }

  // L13 — structureChanged true iff lineup or any per-exercise set count diverges from the template
  {
    const t = { id: "t", name: "T", exercises: [{ exerciseId: "a", name: "a", position: 0, sets: 3, reps: null, targetRir: null }] } as any;
    const same: DraftBlock[] = [{ key: "k", exercise: { id: "a" } as ExerciseDto, sets: [blankSet(), blankSet(), blankSet()] }];
    const fewer: DraftBlock[] = [{ key: "k", exercise: { id: "a" } as ExerciseDto, sets: [blankSet()] }];
    if (structureChanged(t, same)) fail("L13-structure", "identical structure flagged changed");
    if (!structureChanged(t, fewer)) fail("L13-structure", "set-count change not flagged");
  }

  return v;
}

describe("logging eval — placeholder→entry→serialization invariants over a sweep", () => {
  it("scores the logging path across kinds, prev-set shapes, and bodyweights", () => {
    const violations = evaluate();
    const byRule: Record<string, number> = {};
    for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

    /* eslint-disable no-console */
    console.log(`\n=== LOGGING EVAL SCORECARD ===`);
    console.log(`bodyweight×delta×mode cases: ${BODYWEIGHTS.length * DELTAS.length * MODES.length}`);
    console.log(`total violations:            ${violations.length}`);
    for (const [rule, n] of Object.entries(byRule).sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${n}`);
    for (const v of violations.slice(0, 10)) console.log(`  e.g. [${v.rule}] ${v.detail}`);
    console.log(`==============================\n`);
    /* eslint-enable no-console */

    expect(violations, violations.map((v) => `[${v.rule}] ${v.detail}`).join("\n")).toHaveLength(0);
  });
});
