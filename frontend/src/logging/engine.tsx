import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import type { Equipment, ExerciseDto, LoadMode, SetDto, SetType, TemplateDto, TemplateExerciseInput } from "../api/types";

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
  pWeight?: string;
  pDelta?: string;
  pReps?: string;
  pRpe?: string;
}
export interface DraftBlock { key: string; exercise: ExerciseDto; sets: DraftSet[]; }

export const blankSet = (setType: SetType = "WORKING"): DraftSet =>
  ({ key: uid(), setType, weight: "", delta: "", mode: "ADDED", reps: "", rpe: "" });

/** Placeholders carry a previous set's values (used when starting a new session). */
export function seededSet(prev: SetDto, isBw: boolean): DraftSet {
  const d = blankSet(prev.setType);
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
  catalog.find((e) => e.id === id) ?? { id, name, isBodyweight: false, equipment: null, category: "STRENGTH", defaultUnit: "kg" };

export const templateExercisesFromBlocks = (blocks: DraftBlock[]): TemplateExerciseInput[] =>
  blocks.map((b, i) => ({ exerciseId: b.exercise.id, name: b.exercise.name, position: i, sets: b.sets.length }));

/** Did the logged session differ from its template? (exercise added/removed, or a set count changed) */
export const structureChanged = (t: TemplateDto, blocks: DraftBlock[]): boolean => {
  if (t.exercises.length !== blocks.length) return true;
  const want = new Map(t.exercises.map((e) => [e.exerciseId, e.sets]));
  return blocks.some((b) => !want.has(b.exercise.id) || want.get(b.exercise.id) !== b.sets.length);
};

const orPrev = (entry: string, prev?: string) => (entry.trim() || prev || "");

export function toCreateSet(s: DraftSet, orderIndex: number, isBw: boolean, bodyweight: string) {
  const reps = orPrev(s.reps, s.pReps);
  const rpe = orPrev(s.rpe, s.pRpe);
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
    orderIndex, setType: s.setType, weight, loadMode, loadDelta,
    reps: reps ? parseInt(reps, 10) : null,
    rpe: rpe ? parseInt(rpe, 10) : null,
  };
}

/* ---------------------------------------------------------------- exercise block editor */
export function ExerciseBlockEditor({ block, bodyweight, prevSets, prevReady, showLast = true, onChange, onRemove, onExerciseChange }: {
  block: DraftBlock; bodyweight: string; prevSets: SetDto[] | null; prevReady: boolean;
  showLast?: boolean; onChange: (sets: DraftSet[]) => void; onRemove: () => void;
  onExerciseChange?: (ex: ExerciseDto) => void;
}) {
  const qc = useQueryClient();
  const isBw = block.exercise.isBodyweight;
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

  const lastWork = (prevSets ?? []).filter((s) => s.setType === "WORKING").slice(-1)[0];
  const lastLabel = lastWork
    ? `${lastWork.loadMode === "ASSISTED" ? "−" : ""}${lastWork.weight} kg × ${lastWork.reps ?? "?"}${prevSets ? ` · ${prevSets.length} sets` : ""}`
    : "first time";

  const popupSet = popupKey ? block.sets.find((s) => s.key === popupKey) : null;
  let workingNo = 0;

  return (
    <section className="card ex-block">
      <div className="ex-head">
        <div>
          <h3>{block.exercise.name}</h3>
          {showLast && <div className="lasttime">Last time: <b>{lastLabel}</b></div>}
          <button className="equip-chip" onClick={() => setEquipOpen(true)}>
            <span className="dot" /> {equipmentLabel(block.exercise.equipment)}
          </button>
        </div>
        <button className="icon-btn" title="Remove exercise" onClick={onRemove}>×</button>
      </div>

      {block.sets.map((s) => {
        const warm = s.setType === "WARMUP";
        const idx = warm ? "W" : String(++workingNo);
        const eff = isBw
          ? parseFloat(bodyweight || "0") + (s.mode === "ASSISTED" ? -1 : 1) * parseFloat(orPrev(s.delta, s.pDelta) || "0")
          : null;
        return (
          <div key={s.key} className={`set-row${warm ? " is-warmup" : ""}`}>
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
            <div className="cell">
              <span className="micro">rpe</span>
              <input className="cell-input" inputMode="numeric" value={s.rpe}
                placeholder={s.pRpe ?? "—"} onChange={(e) => update(s.key, { rpe: e.target.value })} />
            </div>

            <button className="set-copy" title="Copy this set" onClick={() => copySet(s.key)}>+</button>
          </div>
        );
      })}

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
            <button className="popup-opt danger"
              onClick={() => { removeSet(popupSet.key); setPopupKey(null); }}>Delete set</button>
          </div>
        </div>
      )}

      {equipOpen && (
        <div className="popup-backdrop" onClick={() => setEquipOpen(false)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Equipment · strength</span>
            {EQUIPMENT.map((eq) => (
              <button key={eq.value} className={`popup-opt${block.exercise.equipment === eq.value ? " on" : ""}`}
                disabled={setEquip.isPending} onClick={() => setEquip.mutate(eq.value)}>{eq.label}</button>
            ))}
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
  const [bw, setBw] = useState(false);
  const filtered = exercises.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
  const exact = exercises.some((e) => e.name.toLowerCase() === q.trim().toLowerCase());

  const create = useMutation({
    mutationFn: () => Api.createExercise(q.trim(), bw),
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
          <label className="row micro" style={{ cursor: "pointer", marginBottom: 10 }}>
            <input type="checkbox" checked={bw} onChange={(e) => setBw(e.target.checked)} />
            Bodyweight / calisthenics
          </label>
          <button className="btn btn-volt btn-block" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : `Create “${q.trim()}”`}
          </button>
        </div>
      )}
    </section>
  );
}
