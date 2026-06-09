import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "../api/client";
import type {
  CreateWorkoutRequest, ExerciseDto, LoadMode, SetDto, SetType, TemplateDto, WorkoutDto,
} from "../api/types";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

interface DraftSet {
  key: string;
  setType: SetType;
  weight: string;          // external load (non-bodyweight)
  delta: string;           // bodyweight added/assist magnitude
  mode: "ADDED" | "ASSISTED";
  reps: string;
  rpe: string;
}
interface DraftBlock { key: string; exercise: ExerciseDto; sets: DraftSet[]; }

const blankSet = (setType: SetType = "WORKING"): DraftSet =>
  ({ key: uid(), setType, weight: "", delta: "0", mode: "ADDED", reps: "", rpe: "" });

// Reconstruct a draft set from a previously logged set (prefill weights/reps from last time).
function draftFromSet(s: SetDto, isBw: boolean): DraftSet {
  const d = blankSet(s.setType);
  d.reps = s.reps != null ? String(s.reps) : "";
  d.rpe = s.rpe != null ? String(s.rpe) : "";
  if (isBw) {
    d.mode = s.loadMode === "ASSISTED" ? "ASSISTED" : "ADDED";
    d.delta = s.loadDelta ?? "0";
  } else {
    d.weight = s.weight ?? "";
  }
  return d;
}
const findEx = (catalog: ExerciseDto[], id: string, name: string, isBw: boolean): ExerciseDto =>
  catalog.find((e) => e.id === id) ?? { id, name, isBodyweight: isBw, defaultUnit: "kg" };

// Clone a whole previous session — every exercise + set with its weights/reps.
const blocksFromWorkout = (w: WorkoutDto, catalog: ExerciseDto[]): DraftBlock[] =>
  w.exercises.map((b) => {
    const isBw = b.sets.some((s) => s.loadMode != null) ||
      (catalog.find((e) => e.id === b.exerciseId)?.isBodyweight ?? false);
    const ex = findEx(catalog, b.exerciseId, b.name, isBw);
    return { key: uid(), exercise: ex, sets: b.sets.map((s) => draftFromSet(s, ex.isBodyweight)) };
  });

// Fallback when a template has no logged session yet: just its exercise lineup (editor seeds sets).
const blocksFromTemplate = (t: TemplateDto, catalog: ExerciseDto[]): DraftBlock[] =>
  t.exercises.map((te) => ({ key: uid(), exercise: findEx(catalog, te.exerciseId, te.name, false), sets: [] }));

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

  const startEmpty = () => { setTemplateId(null); setBlocks([]); setStarted(true); };
  const startFromTemplate = (t: TemplateDto) => {
    const catalog = exercises.data ?? [];
    const prev = (workouts.data ?? [])
      .filter((w) => w.templateId === t.id)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    setBlocks(prev ? blocksFromWorkout(prev, catalog) : blocksFromTemplate(t, catalog));
    setTemplateId(t.id);
    setStarted(true);
  };

  const setBlock = (key: string, sets: DraftSet[]) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, sets } : b)));
  const removeBlock = (key: string) => setBlocks((bs) => bs.filter((b) => b.key !== key));
  const addExercise = (ex: ExerciseDto) => {
    setBlocks((bs) => bs.some((b) => b.exercise.id === ex.id) ? bs : [...bs, { key: uid(), exercise: ex, sets: [] }]);
    setPicking(false);
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

/* ---------------------------------------------------------------- start chooser */
function StartChooser({ templates, workouts, onEmpty, onTemplate }: {
  templates: TemplateDto[]; workouts: WorkoutDto[];
  onEmpty: () => void; onTemplate: (t: TemplateDto) => void;
}) {
  const lastForTemplate = (id: string) =>
    workouts.filter((w) => w.templateId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const cleanName = (n: string) => n.replace(/\s*focus/i, "").trim();   // "Anterior (Upper focus)" -> "Anterior (Upper)"

  return (
    <div className="stagger mt">
      <button className="card w-item choose-empty" onClick={onEmpty}>
        <div className="w-date"><span className="d" style={{ color: "var(--volt)" }}>+</span></div>
        <div className="w-meta"><h3>Empty session</h3><div className="sub">Start fresh, add exercises as you go</div></div>
        <div className="w-stat"><span className="micro">blank</span></div>
      </button>

      <p className="micro" style={{ margin: "20px 4px 10px" }}>Or repeat a template — last weights load in</p>

      {templates.map((t) => {
        const prev = lastForTemplate(t.id);
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

function toCreateSet(s: DraftSet, orderIndex: number, isBw: boolean, bodyweight: string) {
  let weight: string, loadMode: LoadMode | null, loadDelta: string | null;
  if (isBw) {
    const bw = parseFloat(bodyweight || "0");
    const d = parseFloat(s.delta || "0");
    const eff = s.mode === "ASSISTED" ? bw - d : bw + d;
    weight = String(eff);
    loadMode = d === 0 ? "BODYWEIGHT" : s.mode;
    loadDelta = String(d);
  } else {
    weight = s.weight.trim() || "0";
    loadMode = null;
    loadDelta = null;
  }
  return {
    orderIndex, setType: s.setType, weight, loadMode, loadDelta,
    reps: s.reps ? parseInt(s.reps, 10) : null,
    rpe: s.rpe ? parseInt(s.rpe, 10) : null,
  };
}

/* ---------------------------------------------------------------- exercise block */
function ExerciseBlockEditor({ block, bodyweight, onChange, onRemove }: {
  block: DraftBlock; bodyweight: string;
  onChange: (sets: DraftSet[]) => void; onRemove: () => void;
}) {
  const isBw = block.exercise.isBodyweight;
  const last = useQuery({
    queryKey: ["lastWorkingSet", block.exercise.id],
    queryFn: () => Api.lastWorkingSet(block.exercise.id),
  });
  const seeded = useRef(false);

  // Seed the first set from "last time" once the lookup settles — instant prefill.
  useEffect(() => {
    if (seeded.current || block.sets.length > 0 || last.isLoading) return;
    seeded.current = true;
    onChange([seedFromLast()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last.isLoading]);

  function seedFromLast(): DraftSet {
    const l = last.data;
    const s = blankSet("WORKING");
    if (!l) return s;
    if (isBw) {
      s.delta = l.loadDelta ?? "0";
      s.mode = l.loadMode === "ASSISTED" ? "ASSISTED" : "ADDED";
    } else if (l.weight) {
      s.weight = l.weight;
    }
    if (l.reps != null) s.reps = String(l.reps);
    return s;
  }

  const update = (key: string, patch: Partial<DraftSet>) =>
    onChange(block.sets.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addSet = (type: SetType) => {
    const prev = [...block.sets].reverse().find((s) => s.setType === "WORKING");
    const base = prev ? { ...prev, key: uid(), setType: type } : (block.sets.length ? { ...block.sets[block.sets.length - 1], key: uid(), setType: type } : seedFromLast());
    onChange([...block.sets, { ...base, setType: type }]);
  };
  const removeSet = (key: string) => onChange(block.sets.filter((s) => s.key !== key));

  const lt = last.data;
  const lastLabel = lt
    ? `${lt.loadMode === "ASSISTED" ? "−" : ""}${lt.weight} kg × ${lt.reps ?? "?"}`
    : "first time";

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

      {isBw && (
        <div className="bw-row">
          <span className="micro">Effective = bodyweight {bodyweight || "?"} kg ± entry</span>
        </div>
      )}

      {block.sets.map((s) => {
        const warm = s.setType === "WARMUP";
        const idx = warm ? "W" : String(++workingNo);
        const eff = isBw
          ? (parseFloat(bodyweight || "0") + (s.mode === "ASSISTED" ? -1 : 1) * parseFloat(s.delta || "0"))
          : null;
        return (
          <div key={s.key} className={`set-row${warm ? " is-warmup" : ""}`}>
            <div className={`set-idx${warm ? " warm" : ""}`}>{idx}</div>

            {isBw ? (
              <div className="cell" style={{ gridColumn: "span 2" }}>
                <span className="micro">{s.mode === "ASSISTED" ? "Assist −kg" : "Added +kg"}</span>
                <div className="row">
                  <div className="seg">
                    <button className={s.mode === "ADDED" ? "on" : ""} onClick={() => update(s.key, { mode: "ADDED" })}>+ Add</button>
                    <button className={s.mode === "ASSISTED" ? "on" : ""} onClick={() => update(s.key, { mode: "ASSISTED" })}>Assist</button>
                  </div>
                  <input className="cell-input" inputMode="decimal" value={s.delta}
                    onChange={(e) => update(s.key, { delta: e.target.value })} placeholder="0" />
                  <span className="readout" style={{ color: "var(--ice)", whiteSpace: "nowrap" }}>= {Number.isFinite(eff) ? eff : "–"} kg</span>
                </div>
              </div>
            ) : (
              <div className="cell">
                <span className="micro">kg</span>
                <input className="cell-input" inputMode="decimal" value={s.weight}
                  onChange={(e) => update(s.key, { weight: e.target.value })} placeholder="0" />
              </div>
            )}

            {!isBw && <div />}

            <div className="cell">
              <span className="micro">reps</span>
              <input className="cell-input" inputMode="numeric" value={s.reps}
                onChange={(e) => update(s.key, { reps: e.target.value })} placeholder="0" />
            </div>
            <div className="cell">
              <span className="micro">rpe</span>
              <input className="cell-input" inputMode="numeric" value={s.rpe}
                onChange={(e) => update(s.key, { rpe: e.target.value })} placeholder="–" />
            </div>
            <button className="icon-btn" title="Remove set" onClick={() => removeSet(s.key)}>×</button>
          </div>
        );
      })}

      <div className="ex-actions">
        <button className="btn btn-volt grow" onClick={() => addSet("WORKING")}>+ Copy last set</button>
        <button className="btn btn-ghost" onClick={() => addSet("WARMUP")}>+ Warmup</button>
      </div>
    </section>
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
