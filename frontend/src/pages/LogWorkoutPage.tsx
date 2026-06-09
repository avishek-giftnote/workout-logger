import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "../api/client";
import type {
  CreateWorkoutRequest, ExerciseDto, LoadMode, SetDto, SetType, TemplateDto, WorkoutDto,
} from "../api/types";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

/** A set being edited. Live entry fields start empty; the previous session's values live in the
 *  `p*` placeholder fields and are used on save when the matching entry is left blank. */
interface DraftSet {
  key: string;
  setType: SetType;
  weight: string;                 // external load entry (non-bodyweight)
  delta: string;                  // bodyweight added/assist entry
  mode: "ADDED" | "ASSISTED";
  reps: string;
  rpe: string;
  pWeight?: string;               // ── placeholders (last time, per set) ──
  pDelta?: string;
  pReps?: string;
  pRpe?: string;
}
interface DraftBlock { key: string; exercise: ExerciseDto; sets: DraftSet[]; }

const blankSet = (setType: SetType = "WORKING"): DraftSet =>
  ({ key: uid(), setType, weight: "", delta: "", mode: "ADDED", reps: "", rpe: "" });

/** Build a draft set whose placeholders carry a previously-logged set's values. */
function seededSet(prev: SetDto, isBw: boolean): DraftSet {
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

const findEx = (catalog: ExerciseDto[], id: string, name: string): ExerciseDto =>
  catalog.find((e) => e.id === id) ?? { id, name, isBodyweight: false, defaultUnit: "kg" };

const blocksFromTemplate = (t: TemplateDto, catalog: ExerciseDto[]): DraftBlock[] =>
  t.exercises.map((te) => ({ key: uid(), exercise: findEx(catalog, te.exerciseId, te.name), sets: [] }));

export default function LogWorkoutPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });

  const [started, setStarted] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useMemo(() => new Date(), []);
  const bodyweight = me.data?.currentBodyweightKg ?? "";

  // Most recent session's sets for a given exercise (API returns workouts newest-first).
  const prevSetsFor = (exerciseId: string): SetDto[] | null => {
    for (const w of workouts.data ?? []) {
      const b = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (b) return b.sets;
    }
    return null;
  };

  const setBlock = (key: string, sets: DraftSet[]) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, sets } : b)));
  const removeBlock = (key: string) => setBlocks((bs) => bs.filter((b) => b.key !== key));
  const addExercise = (ex: ExerciseDto) => {
    setBlocks((bs) => bs.some((b) => b.exercise.id === ex.id) ? bs : [...bs, { key: uid(), exercise: ex, sets: [] }]);
    setPicking(false);
  };
  const startEmpty = () => { setTemplateId(null); setBlocks([]); setStarted(true); };
  const startFromTemplate = (t: TemplateDto) => {
    setBlocks(blocksFromTemplate(t, exercises.data ?? []));
    setTemplateId(t.id);
    setStarted(true);
  };

  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);

  const save = useMutation({
    mutationFn: () => {
      const body: CreateWorkoutRequest = {
        startedAt: startedAt.toISOString(),
        templateId: templateId ?? undefined,
        exercises: blocks.map((b, i) => ({
          exerciseId: b.exercise.id,
          name: b.exercise.name,
          position: i,
          sets: b.sets.map((s, j) => toCreateSet(s, j, b.exercise.isBodyweight, bodyweight)),
        })),
      };
      return Api.createWorkout(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workouts"] }); nav("/"); },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save workout."),
  });

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>{started ? "Log Session" : "Start Workout"}</h1>
          <p>
            {bodyweight
              ? <>Bodyweight <b className="mono" style={{ color: "var(--ice)" }}>{bodyweight} kg</b> · used for calisthenics</>
              : "Set your bodyweight below to log calisthenics"}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => nav("/")}>Cancel</button>
      </div>

      {!bodyweight && <BodyweightSetter />}

      {!started ? (
        <StartChooser
          templates={templates.data ?? []} workouts={workouts.data ?? []}
          onEmpty={startEmpty} onTemplate={startFromTemplate}
        />
      ) : (
        <>
          <div className="stagger">
            {blocks.map((b) => (
              <ExerciseBlockEditor
                key={b.key} block={b} bodyweight={bodyweight}
                prevSets={prevSetsFor(b.exercise.id)} prevReady={workouts.isSuccess}
                onChange={(sets) => setBlock(b.key, sets)} onRemove={() => removeBlock(b.key)}
              />
            ))}
          </div>

          {picking ? (
            <ExercisePicker
              exercises={exercises.data ?? []} disabledIds={blocks.map((b) => b.exercise.id)}
              onPick={addExercise} onClose={() => setPicking(false)}
            />
          ) : (
            <button className="btn btn-ghost btn-block mt" onClick={() => setPicking(true)}>+ Add exercise</button>
          )}

          {error && <p className="err mt">{error}</p>}

          <div className="action-bar">
            <button className="btn btn-ghost grow" onClick={() => nav("/")}>Discard</button>
            <button className="btn btn-volt grow btn-lg" disabled={totalSets === 0 || save.isPending}
              onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : `Finish · ${totalSets} sets`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

/** Resolve a field to its entry, falling back to the placeholder (previous value). */
const orPrev = (entry: string, prev?: string) => (entry.trim() || prev || "");

function toCreateSet(s: DraftSet, orderIndex: number, isBw: boolean, bodyweight: string) {
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

/* ---------------------------------------------------------------- exercise block */
function ExerciseBlockEditor({ block, bodyweight, prevSets, prevReady, onChange, onRemove }: {
  block: DraftBlock; bodyweight: string; prevSets: SetDto[] | null; prevReady: boolean;
  onChange: (sets: DraftSet[]) => void; onRemove: () => void;
}) {
  const isBw = block.exercise.isBodyweight;
  const seeded = useRef(false);
  const [popupKey, setPopupKey] = useState<string | null>(null);

  // Seed the block once: one draft set per previous-session set (count + placeholders match).
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
          <h3>{block.exercise.name} {isBw && <span className="tag tag-bw">BW</span>}</h3>
          <div className="lasttime">Last time: <b>{lastLabel}</b></div>
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
    </section>
  );
}

/* ---------------------------------------------------------------- start chooser */
function StartChooser({ templates, workouts, onEmpty, onTemplate }: {
  templates: TemplateDto[]; workouts: WorkoutDto[];
  onEmpty: () => void; onTemplate: (t: TemplateDto) => void;
}) {
  const lastFor = (id: string) =>
    workouts.filter((w) => w.templateId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const cleanName = (n: string) => n.replace(/\s*focus/i, "").trim();

  return (
    <div className="stagger mt">
      <button className="card w-item" onClick={onEmpty}>
        <div className="w-date"><span className="d" style={{ color: "var(--volt)" }}>+</span></div>
        <div className="w-meta"><h3>Empty session</h3><div className="sub">Start fresh, add exercises as you go</div></div>
        <div className="w-stat"><span className="micro">blank</span></div>
      </button>

      <p className="micro" style={{ margin: "20px 4px 10px" }}>Or repeat a template — last sets load in</p>

      {templates.map((t) => {
        const prev = lastFor(t.id);
        return (
          <button key={t.id} className="card w-item" onClick={() => onTemplate(t)}>
            <div className="w-date">
              <span className="d" style={{ fontSize: 20 }}>{t.exercises.length}</span>
              <span className="m">moves</span>
            </div>
            <div className="w-meta">
              <h3>{cleanName(t.name)}</h3>
              <div className="sub">
                {prev ? `last: ${new Date(prev.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : "no history yet"}
              </div>
            </div>
            <div className="w-stat"><span className="readout" style={{ color: "var(--volt)" }}>›</span></div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- exercise picker */
function ExercisePicker({ exercises, disabledIds, onPick, onClose }: {
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

/* ---------------------------------------------------------------- bodyweight setter */
function BodyweightSetter() {
  const qc = useQueryClient();
  const [v, setV] = useState("");
  const save = useMutation({
    mutationFn: () => Api.setBodyweight(v.trim()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  return (
    <section className="card card-pad mt fade-up">
      <span className="micro">Set bodyweight (kg)</span>
      <div className="row mt">
        <input className="input mono grow" inputMode="decimal" placeholder="e.g. 72.5"
          value={v} onChange={(e) => setV(e.target.value)} />
        <button className="btn btn-volt" disabled={!v.trim() || save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </section>
  );
}
