import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import { useSettings } from "../settings";
import type { CardioMetric, Equipment, ExerciseDto, LoadMode, SetDto, SetType, TemplateDto, TemplateExerciseInput } from "../api/types";

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/** Strength-training equipment options (cardio comes later). */
export const EQUIPMENT: { value: Equipment; label: string }[] = [
  { value: "BARBELL", label: "Barbell" },
  { value: "DUMBBELL", label: "Dumbbell" },
  { value: "SMITH_MACHINE", label: "Smith machine" },
  { value: "KETTLEBELL", label: "Kettlebell" },
  { value: "MACHINE", label: "Machine" },
  { value: "CABLE", label: "Cable" },
  { value: "BODYWEIGHT", label: "Bodyweight" },
  { value: "OTHER", label: "Other" },
];
export const equipmentLabel = (e: Equipment | null) =>
  EQUIPMENT.find((x) => x.value === e)?.label ?? "Set equipment";

/** A set being edited. Live entry fields; `p*` hold previous-session placeholders (new-session mode). */
export interface DraftSet {
  key: string;
  setType: SetType;
  weight: string;
  delta: string;
  mode: "ADDED" | "ASSISTED";
  reps: string;
  rpe: string;
  done?: boolean;          // marked complete this session (UI only, not persisted)
  pWeight?: string;
  pDelta?: string;
  pReps?: string;
  pRpe?: string;
  // cardio entries (km, mm:ss, %, m, spm) — strings like the rest
  distance?: string;
  time?: string;
  grade?: string;
  elev?: string;
  cadence?: string;
  pDistance?: string;
  pTime?: string;
}
export interface DraftBlock { key: string; exercise: ExerciseDto; sets: DraftSet[]; note?: string }

export const blankSet = (setType: SetType = "WORKING"): DraftSet =>
  ({ key: uid(), setType, weight: "", delta: "", mode: "ADDED", reps: "", rpe: "" });

// ── cardio helpers ──
export const isCardioEx = (ex: ExerciseDto) => ex.category === "CARDIO";
export const CARDIO_METRICS: { value: CardioMetric; label: string }[] = [
  { value: "DISTANCE", label: "Distance" },
  { value: "DURATION", label: "Time" },
  { value: "PACE", label: "Pace / speed" },
  { value: "GRADE", label: "Grade %" },
  { value: "ELEVATION", label: "Elevation" },
  { value: "CADENCE", label: "Cadence" },
];
export const DEFAULT_CARDIO_METRICS: CardioMetric[] = ["DISTANCE", "DURATION", "PACE"];
export const cardioMetricsOf = (ex: ExerciseDto): CardioMetric[] =>
  ex.cardioMetrics && ex.cardioMetrics.length ? ex.cardioMetrics : DEFAULT_CARDIO_METRICS;

/** Rest-timer presets (seconds); null = use the global default. */
export const REST_PRESETS: { v: number | null; label: string }[] = [
  { v: null, label: "Default" }, { v: 60, label: "1:00" }, { v: 90, label: "1:30" },
  { v: 120, label: "2:00" }, { v: 180, label: "3:00" }, { v: 300, label: "5:00" },
];
export const fmtRest = (s: number | null | undefined) =>
  s == null ? "Default" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
/** Parse a rest entry: "m:ss" → seconds, or a bare number → seconds. Blank → null (use default). */
export function parseRest(str: string): number | null {
  const v = (str ?? "").trim();
  if (!v) return null;
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return (parseInt(m || "0", 10) || 0) * 60 + (parseInt(s || "0", 10) || 0);
  }
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

/** Custom rest input + quick-option chips. Internal text state; `sec` drives the chip highlight. */
export function RestPicker({ initial, onChange }: { initial: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(initial == null ? "" : fmtRest(initial));
  const sec = parseRest(text);
  const set = (v: number | null) => { setText(v == null ? "" : fmtRest(v)); onChange(v); };
  return (
    <div>
      <input className="input mono" placeholder="Custom — m:ss or seconds (e.g. 1:30 or 90)"
        value={text} onChange={(e) => { setText(e.target.value); onChange(parseRest(e.target.value)); }} />
      <div className="chip-wrap" style={{ marginTop: 8 }}>
        {REST_PRESETS.map((p) => (
          <button key={String(p.v)} className={`chip-toggle${sec === p.v ? " on" : ""}`}
            onClick={() => set(p.v)}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}
const secToMmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
export function mmssToSec(t: string): number | null {
  const v = (t ?? "").trim();
  if (!v) return null;
  if (v.includes(":")) {
    const [m, s] = v.split(":");
    return (parseInt(m || "0", 10) || 0) * 60 + (parseInt(s || "0", 10) || 0);
  }
  return Math.round(parseFloat(v) * 60);   // bare number = minutes
}
/** Derived pace (/km) + speed (km/h) from distance(km) + duration(s) — never stored. */
export function paceSpeed(distanceKm: number, durationS: number): { pace: string; speed: string } | null {
  if (!(distanceKm > 0) || !(durationS > 0)) return null;
  const speed = distanceKm / (durationS / 3600);
  const paceSec = durationS / distanceKm;
  return { pace: `${secToMmss(Math.round(paceSec))} /km`, speed: `${speed.toFixed(1)} km/h` };
}

/** Placeholders carry a previous set's values (used when starting a new session). */
export function seededSet(prev: SetDto, isBw: boolean): DraftSet {
  const d = blankSet(prev.setType);
  if (prev.kind === "CARDIO") {
    if (prev.distanceM) d.pDistance = String(parseFloat(prev.distanceM) / 1000);
    if (prev.durationS != null) d.pTime = secToMmss(prev.durationS);
    return d;
  }
  if (isBw) {
    d.mode = prev.loadMode === "ASSISTED" ? "ASSISTED" : "ADDED";
    d.pDelta = prev.loadDelta ?? "0";
  } else if (prev.weight) {
    d.pWeight = prev.weight;
  }
  if (prev.reps != null) d.pReps = String(prev.reps);
  if (prev.rpe != null) d.pRpe = String(prev.rpe);
  return d;
}

/** Entry fields carry the actual values (used when editing a completed workout). */
export function filledSet(prev: SetDto, isBw: boolean): DraftSet {
  const d = blankSet(prev.setType);
  d.done = true;   // already-performed sets in an edited workout show as completed
  if (prev.kind === "CARDIO") {
    if (prev.distanceM) d.distance = String(parseFloat(prev.distanceM) / 1000);
    if (prev.durationS != null) d.time = secToMmss(prev.durationS);
    if (prev.gradePct) d.grade = prev.gradePct;
    if (prev.elevationGainM) d.elev = prev.elevationGainM;
    if (prev.cadenceSpm != null) d.cadence = String(prev.cadenceSpm);
    return d;
  }
  if (isBw) {
    d.mode = prev.loadMode === "ASSISTED" ? "ASSISTED" : "ADDED";
    d.delta = prev.loadDelta ?? "0";
  } else if (prev.weight) {
    d.weight = prev.weight;
  }
  if (prev.reps != null) d.reps = String(prev.reps);
  if (prev.rpe != null) d.rpe = String(prev.rpe);
  return d;
}

export const findEx = (catalog: ExerciseDto[], id: string, name: string): ExerciseDto =>
  catalog.find((e) => e.id === id) ?? { id, name, isBodyweight: false, equipment: null, category: "STRENGTH", defaultUnit: "kg", restSeconds: null, cardioMetrics: null };

export const templateExercisesFromBlocks = (blocks: DraftBlock[]): TemplateExerciseInput[] =>
  blocks.map((b, i) => ({ exerciseId: b.exercise.id, name: b.exercise.name, position: i, sets: b.sets.length }));

/** Did the logged session differ from its template? (exercise added/removed, or a set count changed) */
export const structureChanged = (t: TemplateDto, blocks: DraftBlock[]): boolean => {
  if (t.exercises.length !== blocks.length) return true;
  const want = new Map(t.exercises.map((e) => [e.exerciseId, e.sets]));
  return blocks.some((b) => !want.has(b.exercise.id) || want.get(b.exercise.id) !== b.sets.length);
};

const orPrev = (entry: string, prev?: string) => (entry.trim() || prev || "");

export function toCreateSet(s: DraftSet, orderIndex: number, isBw: boolean, bodyweight: string, includeRpe = true, isCardio = false) {
  if (isCardio) {
    const km = parseFloat(orPrev(s.distance ?? "", s.pDistance) || "");
    return {
      orderIndex, setType: s.setType, kind: "CARDIO" as const,
      weight: null, loadMode: null, loadDelta: null, reps: null, rpe: null,
      distanceM: Number.isFinite(km) && km > 0 ? String(Math.round(km * 1e6) / 1e3) : null,   // km→m, mm-rounded (no float drift)
      durationS: mmssToSec(orPrev(s.time ?? "", s.pTime)),
      gradePct: (s.grade ?? "").trim() || null,
      elevationGainM: (s.elev ?? "").trim() || null,
      cadenceSpm: (s.cadence ?? "").trim() ? parseInt(s.cadence!, 10) : null,
    };
  }
  const reps = orPrev(s.reps, s.pReps);
  const rpe = includeRpe ? orPrev(s.rpe, s.pRpe) : "";
  let weight: string, loadMode: LoadMode | null, loadDelta: string | null;
  if (isBw) {
    const bw = parseFloat(bodyweight || "0");
    const d = parseFloat(orPrev(s.delta, s.pDelta) || "0");
    weight = String(s.mode === "ASSISTED" ? bw - d : bw + d);
    loadMode = d === 0 ? "BODYWEIGHT" : s.mode;
    loadDelta = String(d);
  } else {
    weight = orPrev(s.weight, s.pWeight) || "0";
    loadMode = null;
    loadDelta = null;
  }
  return {
    orderIndex, setType: s.setType, kind: "STRENGTH" as const, weight, loadMode, loadDelta,
    reps: reps ? parseInt(reps, 10) : null,
    rpe: rpe ? parseInt(rpe, 10) : null,
  };
}

/* ---------------------------------------------------------------- exercise block editor */
export function ExerciseBlockEditor({ block, bodyweight, prevSets, prevReady, showLast = true, onChange, onRemove, onExerciseChange, onSetCompleted, onSetUncompleted, onMoveUp, onMoveDown, onNoteChange }: {
  block: DraftBlock; bodyweight: string; prevSets: SetDto[] | null; prevReady: boolean;
  showLast?: boolean; onChange: (sets: DraftSet[]) => void; onRemove: () => void;
  onExerciseChange?: (ex: ExerciseDto) => void;
  onSetCompleted?: (restSeconds: number | null) => void; onSetUncompleted?: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void; onNoteChange?: (note: string) => void;
}) {
  const qc = useQueryClient();
  const { showRpe } = useSettings();
  const isBw = block.exercise.isBodyweight;
  const isCardio = isCardioEx(block.exercise);
  const seeded = useRef(false);
  const [popupKey, setPopupKey] = useState<string | null>(null);
  const [equipOpen, setEquipOpen] = useState(false);

  const setEquip = useMutation({
    mutationFn: (eq: Equipment) => Api.setExerciseEquipment(block.exercise.id, eq),
    onSuccess: (ex) => { qc.invalidateQueries({ queryKey: ["exercises"] }); onExerciseChange?.(ex); setEquipOpen(false); },
  });

  useEffect(() => {
    if (seeded.current || block.sets.length > 0 || !prevReady) return;
    seeded.current = true;
    onChange(prevSets && prevSets.length
      ? prevSets.map((p) => seededSet(p, isBw))
      : [blankSet("WORKING")]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevReady]);

  const update = (key: string, patch: Partial<DraftSet>) =>
    onChange(block.sets.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const removeSet = (key: string) => onChange(block.sets.filter((s) => s.key !== key));
  const moveSet = (key: string, dir: -1 | 1) => {
    const i = block.sets.findIndex((s) => s.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= block.sets.length) return;
    const next = [...block.sets];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const copySet = (key: string) => {
    const i = block.sets.findIndex((s) => s.key === key);
    if (i < 0) return;
    const copy: DraftSet = { ...block.sets[i], key: uid(), setType: "WORKING" };
    const next = [...block.sets];
    next.splice(i + 1, 0, copy);
    onChange(next);
  };
  const addSet = () => {
    const last = [...block.sets].reverse().find((s) => s.setType === "WORKING") ?? block.sets[block.sets.length - 1];
    onChange([...block.sets, last ? { ...last, key: uid(), setType: "WORKING" } : blankSet("WORKING")]);
  };
  // Completing a set commits its placeholders (last-time values) into the real entry fields.
  const toggleDone = (s: DraftSet) => {
    if (s.done) { update(s.key, { done: false }); onSetUncompleted?.(); return; }   // un-tick clears the rest timer
    const p: Partial<DraftSet> = { done: true };
    const fill = (entry: keyof DraftSet, val?: string) => {
      if (!((s[entry] as string) ?? "").trim() && val) (p as Record<string, unknown>)[entry] = val;
    };
    if (isCardio) { fill("distance", s.pDistance); fill("time", s.pTime); }
    else if (isBw) { fill("delta", s.pDelta); fill("reps", s.pReps); fill("rpe", s.pRpe); }
    else { fill("weight", s.pWeight); fill("reps", s.pReps); fill("rpe", s.pRpe); }
    update(s.key, p);
    onSetCompleted?.(block.exercise.restSeconds ?? null);   // (re)start the rest timer (exercise-specific target)
  };

  const lastWork = (prevSets ?? []).filter((s) => s.setType === "WORKING").slice(-1)[0];
  const lastLabel = !lastWork ? "first time"
    : isCardio
      ? `${lastWork.distanceM ? (parseFloat(lastWork.distanceM) / 1000).toFixed(2) + " km" : "?"}${lastWork.durationS ? " · " + secToMmss(lastWork.durationS) : ""}`
      : `${lastWork.loadMode === "ASSISTED" ? "−" : ""}${lastWork.weight} kg × ${lastWork.reps ?? "?"}${prevSets ? ` · ${prevSets.length} sets` : ""}`;

  const popupSet = popupKey ? block.sets.find((s) => s.key === popupKey) : null;
  let workingNo = 0;

  return (
    <section className="card ex-block">
      <div className="ex-head">
        <div>
          <h3>{block.exercise.name}</h3>
          {showLast && <div className="lasttime">Last time: <b>{lastLabel}</b></div>}
          {isCardio ? (
            <span className="tag" style={{ marginTop: 9, display: "inline-block" }}>Cardio</span>
          ) : (
            <button className="equip-chip" onClick={() => setEquipOpen(true)}>
              <span className="dot" /> {equipmentLabel(block.exercise.equipment)}
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 2 }}>
          {onMoveUp && <button className="icon-btn" title="Move up" onClick={onMoveUp}>↑</button>}
          {onMoveDown && <button className="icon-btn" title="Move down" onClick={onMoveDown}>↓</button>}
          <button className="icon-btn" title="Remove exercise" onClick={onRemove}>×</button>
        </div>
      </div>

      {block.sets.map((s) => {
        const warm = s.setType === "WARMUP";
        const idx = warm ? "W" : String(++workingNo);

        if (isCardio) {
          const m = cardioMetricsOf(block.exercise);
          const has = (x: CardioMetric) => m.includes(x);
          const km = parseFloat(orPrev(s.distance ?? "", s.pDistance) || "");
          const ds = mmssToSec(orPrev(s.time ?? "", s.pTime));
          const ps = Number.isFinite(km) && ds ? paceSpeed(km, ds) : null;
          const cField = (label: string, k: keyof DraftSet, ph: string, mode: string) => (
            <label className="cardio-field">
              <span className="micro">{label}</span>
              <input className="cell-input" inputMode={mode as never} value={(s[k] as string) ?? ""}
                placeholder={ph} onChange={(e) => update(s.key, { [k]: e.target.value } as Partial<DraftSet>)} />
            </label>
          );
          const line2 = has("GRADE") || has("ELEVATION") || has("CADENCE");
          return (
            <div key={s.key} className={`set-row cardio-row${s.done ? " is-done" : ""}`}>
              <button className={`set-idx${warm ? " warm" : ""}`} title="Set options"
                onClick={() => setPopupKey(s.key)}>{idx}<i className="set-idx-caret" /></button>
              <div className="cardio-fields">
                <div className="cardio-line">
                  {has("DISTANCE") && cField("km", "distance", s.pDistance ?? "—", "decimal")}
                  {has("DURATION") && cField("time", "time", s.pTime ?? "mm:ss", "text")}
                  {has("PACE") && <span className="cardio-derived">{ps ? `${ps.pace} · ${ps.speed}` : "—"}</span>}
                </div>
                {line2 && (
                  <div className="cardio-line">
                    {has("GRADE") && cField("grade %", "grade", "–", "decimal")}
                    {has("ELEVATION") && cField("elev m", "elev", "–", "decimal")}
                    {has("CADENCE") && cField("cad spm", "cadence", "–", "numeric")}
                  </div>
                )}
              </div>
              <button className={`set-done${s.done ? " on" : ""}`}
                title={s.done ? "Completed — tap to undo" : "Complete set"}
                onClick={() => toggleDone(s)}>✓</button>
            </div>
          );
        }

        const eff = isBw
          ? parseFloat(bodyweight || "0") + (s.mode === "ASSISTED" ? -1 : 1) * parseFloat(orPrev(s.delta, s.pDelta) || "0")
          : null;
        return (
          <div key={s.key} className={`set-row${warm ? " is-warmup" : ""}${s.done ? " is-done" : ""}${showRpe ? "" : " no-rpe"}`}>
            <button className={`set-idx${warm ? " warm" : ""}`} title="Set options"
              onClick={() => setPopupKey(s.key)}>{idx}<i className="set-idx-caret" /></button>

            {isBw ? (
              <div className="cell">
                <span className="micro" style={{ color: Number.isFinite(eff) ? "var(--ice)" : undefined }}>
                  {Number.isFinite(eff) ? `= ${eff} kg` : "± kg"}
                </span>
                <div className="row" style={{ gap: 4 }}>
                  <button type="button" className="bw-mode" title="Added (+) / Assisted (−)"
                    onClick={() => update(s.key, { mode: s.mode === "ADDED" ? "ASSISTED" : "ADDED" })}>
                    {s.mode === "ASSISTED" ? "−" : "+"}
                  </button>
                  <input className="cell-input" inputMode="decimal" value={s.delta}
                    placeholder={s.pDelta ?? "0"} onChange={(e) => update(s.key, { delta: e.target.value })} />
                </div>
              </div>
            ) : (
              <div className="cell">
                <span className="micro">kg</span>
                <input className="cell-input" inputMode="decimal" value={s.weight}
                  placeholder={s.pWeight ?? "—"} onChange={(e) => update(s.key, { weight: e.target.value })} />
              </div>
            )}

            <div className="cell">
              <span className="micro">reps</span>
              <input className="cell-input" inputMode="numeric" value={s.reps}
                placeholder={s.pReps ?? "—"} onChange={(e) => update(s.key, { reps: e.target.value })} />
            </div>
            {showRpe && (
              <div className="cell">
                <span className="micro">rpe</span>
                <input className="cell-input" inputMode="numeric" value={s.rpe}
                  placeholder={s.pRpe ?? "—"} onChange={(e) => update(s.key, { rpe: e.target.value })} />
              </div>
            )}

            <button className={`set-done${s.done ? " on" : ""}`}
              title={s.done ? "Completed — tap to undo" : "Complete set"}
              onClick={() => toggleDone(s)}>✓</button>
          </div>
        );
      })}

      {onNoteChange && (
        <input className="ex-note" placeholder="Note (optional)…" value={block.note ?? ""}
          onChange={(e) => onNoteChange(e.target.value)} />
      )}

      <div className="ex-actions">
        <button className="btn btn-ghost btn-block" onClick={addSet}>+ Add set</button>
      </div>

      {popupSet && (
        <div className="popup-backdrop" onClick={() => setPopupKey(null)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Set {popupSet.setType === "WARMUP" ? "· warm-up" : ""}</span>
            <button className={`popup-opt${popupSet.setType === "WORKING" ? " on" : ""}`}
              onClick={() => { update(popupSet.key, { setType: "WORKING" }); setPopupKey(null); }}>Working set</button>
            <button className={`popup-opt${popupSet.setType === "WARMUP" ? " on" : ""}`}
              onClick={() => { update(popupSet.key, { setType: "WARMUP" }); setPopupKey(null); }}>Warm-up set</button>
            <button className="popup-opt"
              onClick={() => { copySet(popupSet.key); setPopupKey(null); }}>Duplicate set</button>
            <div className="row" style={{ gap: 6 }}>
              <button className="popup-opt grow" disabled={block.sets[0]?.key === popupSet.key}
                onClick={() => { moveSet(popupSet.key, -1); setPopupKey(null); }}>↑ Move up</button>
              <button className="popup-opt grow" disabled={block.sets[block.sets.length - 1]?.key === popupSet.key}
                onClick={() => { moveSet(popupSet.key, 1); setPopupKey(null); }}>↓ Move down</button>
            </div>
            <button className="popup-opt danger"
              onClick={() => { removeSet(popupSet.key); setPopupKey(null); }}>Delete set</button>
          </div>
        </div>
      )}

      {equipOpen && (
        <div className="popup-backdrop" onClick={() => setEquipOpen(false)}>
          <div className="popup-card equip-pop" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Equipment</span>
            <div className="equip-grid">
              {EQUIPMENT.map((eq) => (
                <button key={eq.value} className={`popup-opt${block.exercise.equipment === eq.value ? " on" : ""}`}
                  disabled={setEquip.isPending} onClick={() => setEquip.mutate(eq.value)}>{eq.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- exercise picker */
export function ExercisePicker({ exercises, disabledIds, onPick, onClose }: {
  exercises: ExerciseDto[]; disabledIds: string[];
  onPick: (ex: ExerciseDto) => void; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<"STRENGTH" | "CARDIO">("STRENGTH");
  const [restSec, setRestSec] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<CardioMetric[]>(DEFAULT_CARDIO_METRICS);
  const toggleMetric = (m: CardioMetric) =>
    setMetrics((cur) => cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : [...cur, m]);
  const filtered = exercises.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
  const exact = exercises.some((e) => e.name.toLowerCase() === q.trim().toLowerCase());

  const create = useMutation({
    mutationFn: () => Api.createExercise(q.trim(), false, cat, restSec, cat === "CARDIO" ? metrics : null),
    onSuccess: (ex) => { qc.invalidateQueries({ queryKey: ["exercises"] }); onPick(ex); },
  });

  return (
    <section className="card card-pad mt fade-up">
      <div className="spread" style={{ marginBottom: 12 }}>
        <span className="micro">Add exercise</span>
        <button className="icon-btn" onClick={onClose}>×</button>
      </div>
      <input className="input mono" autoFocus placeholder="Search or name a new exercise…"
        value={q} onChange={(e) => setQ(e.target.value)} />

      <div style={{ maxHeight: 240, overflow: "auto", marginTop: 10 }}>
        {filtered.map((e) => (
          <button key={e.id} className="btn btn-ghost btn-block" style={{ justifyContent: "space-between", marginTop: 6 }}
            disabled={disabledIds.includes(e.id)} onClick={() => onPick(e)}>
            <span>{e.name}</span>
            {e.isBodyweight && <span className="tag tag-bw">BW</span>}
          </button>
        ))}
      </div>

      {q.trim() && !exact && (
        <div className="card-pad" style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingLeft: 0, paddingRight: 0 }}>
          <span className="micro">Category</span>
          <div className="seg" style={{ width: "100%", margin: "6px 0 12px" }}>
            <button className={cat === "STRENGTH" ? "on" : ""} style={{ flex: 1 }} onClick={() => setCat("STRENGTH")}>Strength Training</button>
            <button className={cat === "CARDIO" ? "on" : ""} style={{ flex: 1 }} onClick={() => setCat("CARDIO")}>Cardiovascular</button>
          </div>

          {cat === "CARDIO" && (
            <>
              <span className="micro">Metrics to log</span>
              <div className="chip-wrap" style={{ margin: "6px 0 12px" }}>
                {CARDIO_METRICS.map((m) => (
                  <button key={m.value} className={`chip-toggle${metrics.includes(m.value) ? " on" : ""}`}
                    onClick={() => toggleMetric(m.value)}>{m.label}</button>
                ))}
              </div>
            </>
          )}

          <span className="micro">Rest timer</span>
          <div style={{ margin: "6px 0 12px" }}>
            <RestPicker initial={restSec} onChange={setRestSec} />
          </div>

          <button className="btn btn-volt btn-block" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : `Create “${q.trim()}”`}
          </button>
        </div>
      )}
    </section>
  );
}
