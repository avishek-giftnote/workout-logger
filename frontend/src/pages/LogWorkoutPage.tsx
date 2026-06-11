import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "../api/client";
import type { CreateWorkoutRequest, ExerciseDto, Muscle, SetDto, TemplateDto, TemplateExerciseDto } from "../api/types";
import {
  DraftBlock, ExerciseBlockEditor, ExercisePicker, findEx, isCardioEx, structureChanged,
  templateExercisesFromBlocks, toCreateSet, uid,
} from "../logging/engine";
import { useSettings } from "../settings";
import { currentMicro, phaseMod } from "../periodization";
import { loadIncrement, progressedSeed, readiness, rirWave, topWorkingSet } from "../prescription";
import { muscleLabel } from "../muscles";
import RestTimer from "../components/RestTimer";
import StartChooser from "./StartChooser";

const cleanName = (n: string) => n.replace(/\s*focus/i, "").trim();

const blocksFromTemplate = (t: TemplateDto, catalog: ExerciseDto[]): DraftBlock[] =>
  t.exercises.map((te) => ({ key: uid(), exercise: findEx(catalog, te.exerciseId, te.name), sets: [] }));

const workingSet = (i: number, weight: string | null, reps: number | null, rpe: number | null): SetDto => ({
  id: `rx${i}`, orderIndex: i, setType: "WORKING", weight, loadMode: null, loadDelta: null,
  weightUnit: "kg", reps, rpe, note: null, estimated: null, kind: "STRENGTH",
  distanceM: null, durationS: null, gradePct: null, elevationGainM: null, cadenceSpm: null,
});

export default function LogWorkoutPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const splits = useQuery({ queryKey: ["splits"], queryFn: Api.listSplits });
  const plan = useQuery({ queryKey: ["plan"], queryFn: Api.getPlan });
  const planDeload = plan.data ? !!currentMicro(plan.data)?.isDeload : false;

  const [started, setStarted] = useState(false);
  const [deload, setDeload] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "save-template" | "update-template">(null);
  const [templateName, setTemplateName] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const startedAt = useMemo(() => new Date(), []);
  const bodyweight = me.data?.currentBodyweightKg ?? "";
  const sourceTemplate = templates.data?.find((t) => t.id === templateId) ?? null;
  const done = () => nav("/previous-workouts");
  const { prevSource, showRpe, restTarget, restTimerEnabled } = useSettings();
  const [rest, setRest] = useState<{ at: number; target: number } | null>(null);
  const [soreNow, setSoreNow] = useState<Muscle[]>([]);

  const planMeso = plan.data ? currentMicro(plan.data)?.meso ?? null : null;
  const primaryMuscleOf = (exerciseId: string): Muscle | null =>
    findEx(exercises.data ?? [], exerciseId, "").muscleContributions.find((c) => parseFloat(c.fraction) >= 1)?.muscle ?? null;
  // readiness from logged history (recent soreness reports + last session's reps) — eases the upcoming session.
  // target = the reps livingSeed actually seeds (meso repLow), so the trim doesn't stack on the RIR wave.
  const easeFor = (exerciseId: string) => {
    const pm = primaryMuscleOf(exerciseId);
    if (!pm) return { trim: false, reason: null as string | null };
    const target = planMeso?.intensityBand?.repLow ?? sourceTemplate?.exercises.find((e) => e.exerciseId === exerciseId)?.reps ?? 8;
    return readiness(workouts.data ?? [], exerciseId, pm, target, startedAt.getTime());
  };
  // muscles this session trains (for the "still sore?" prompt)
  const sessionMuscles = useMemo(
    () => [...new Set(blocks.map((b) => primaryMuscleOf(b.exercise.id)).filter((m): m is Muscle => !!m))],
    [blocks, exercises.data]);

  const historyFor = (exerciseId: string): SetDto[] | null => {
    for (const w of workouts.data ?? []) {
      // "Same template" setting: only seed from sessions of this template (when in one).
      if (prevSource === "template" && templateId && w.templateId !== templateId) continue;
      const b = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (b) return b.sets;
    }
    return null;
  };

  // The living plan: a prescribed exercise seeds a progressed load (double progression off the latest
  // working set, scaled by the phase) + the meso's RIR wave. No history → load blank (fills on first log).
  const livingSeed = (te: TemplateExerciseDto, ex: ExerciseDto): SetDto[] => {
    const micro = plan.data ? currentMicro(plan.data) : null;
    const meso = micro?.meso ?? null;
    const repLow = meso?.intensityBand?.repLow ?? te.reps ?? 8;
    const repHigh = meso?.intensityBand?.repHigh ?? repLow + 4;
    const rir = rirWave(micro?.week ?? 1, meso?.accumulationWeeks ?? 4, phaseMod(meso?.phase).rirFloor);
    const prev = topWorkingSet(workouts.data ?? [], ex.id);
    const { load, reps } = progressedSeed(prev, repLow, repHigh, phaseMod(meso?.phase).progressMult, loadIncrement(ex), ex.isBodyweight);
    return Array.from({ length: Math.max(1, te.sets) }, (_, i) =>
      workingSet(i, load != null ? String(load) : null, prev ? reps : (te.reps ?? repLow), 10 - rir));
  };

  const prevSetsFor = (exerciseId: string): SetDto[] | null => {
    const te = sourceTemplate?.exercises.find((e) => e.exerciseId === exerciseId);
    const ex = findEx(exercises.data ?? [], exerciseId, "");
    const history = historyFor(exerciseId);
    let base: SetDto[] | null;
    if (te && te.reps != null && !(ex.isBodyweight && history)) base = livingSeed(te, ex);  // prescribed → living numbers
    else base = history;                                                                     // ad-hoc / bodyweight → echo
    // readiness: ease an under-recovered muscle — drop a set + raise RIR (lower the seeded RPE)
    if (base && base.length && easeFor(exerciseId).trim) {
      base = base.slice(0, Math.max(1, base.length - 1)).map((s) => ({ ...s, rpe: s.rpe != null ? Math.max(1, s.rpe - 1) : s.rpe }));
    }
    return base;
  };
  const easedNotes = started
    ? blocks.map((b) => ({ name: b.exercise.name, ...easeFor(b.exercise.id) })).filter((e) => e.trim)
    : [];

  const setBlock = (key: string, sets: DraftBlock["sets"]) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, sets } : b)));
  const setBlockExercise = (key: string, exercise: ExerciseDto) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, exercise } : b)));
  const setBlockNote = (key: string, note: string) =>
    setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, note } : b)));
  const removeBlock = (key: string) => setBlocks((bs) => bs.filter((b) => b.key !== key));
  const moveBlock = (key: string, dir: -1 | 1) => setBlocks((bs) => {
    const i = bs.findIndex((b) => b.key === key), j = i + dir;
    if (i < 0 || j < 0 || j >= bs.length) return bs;
    const next = [...bs]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const addExercise = (ex: ExerciseDto) => {
    setBlocks((bs) => bs.some((b) => b.exercise.id === ex.id) ? bs : [...bs, { key: uid(), exercise: ex, sets: [] }]);
    setPicking(false);
  };
  const startEmpty = () => { setTemplateId(null); setBlocks([]); setDeload(planDeload); setStarted(true); };
  const startFromTemplate = (t: TemplateDto) => {
    setBlocks(blocksFromTemplate(t, exercises.data ?? []));
    setTemplateId(t.id);
    setDeload(planDeload);
    setStarted(true);
  };

  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);
  const doneSets = blocks.reduce((n, b) => n + b.sets.filter((s) => s.done).length, 0);
  const hasIncomplete = blocks.some((b) => b.sets.some((s) => !s.done));
  // Only completed sets are saved; exercises with no completed set are dropped (and so is their template entry).
  const finishedBlocks = () =>
    blocks.map((b) => ({ ...b, sets: b.sets.filter((s) => s.done) })).filter((b) => b.sets.length > 0);

  const save = useMutation({
    mutationFn: () => {
      const fin = finishedBlocks();
      const body: CreateWorkoutRequest = {
        startedAt: startedAt.toISOString(),
        templateId: templateId ?? undefined,
        cyclePhase: deload ? "DELOAD" : undefined,
        soreMuscles: soreNow.length ? soreNow : undefined,
        exercises: fin.map((b, i) => ({
          exerciseId: b.exercise.id,
          name: b.exercise.name,
          position: i,
          note: b.note?.trim() || undefined,
          sets: b.sets.map((s, j) => toCreateSet(s, j, b.exercise.isBodyweight, bodyweight, showRpe, isCardioEx(b.exercise))),
        })),
      };
      return Api.createWorkout(body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workouts"] });
      const fin = finishedBlocks();
      if (!templateId && fin.length) { setTemplateName(""); setDialog("save-template"); }
      else if (sourceTemplate && structureChanged(sourceTemplate, fin)) setDialog("update-template");
      else done();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save workout."),
  });

  const onFinish = () => { if (hasIncomplete) setConfirmDiscard(true); else save.mutate(); };
  const discardAndFinish = () => {
    setConfirmDiscard(false);
    if (finishedBlocks().length === 0) done(); else save.mutate();   // nothing completed → just leave
  };

  const saveTemplate = useMutation({
    mutationFn: (name: string) => Api.createTemplate({ name, exercises: templateExercisesFromBlocks(finishedBlocks()) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); done(); },
    onError: done,
  });
  const updateTemplate = useMutation({
    mutationFn: () => Api.updateTemplate(sourceTemplate!.id,
      { name: sourceTemplate!.name, exercises: templateExercisesFromBlocks(finishedBlocks(), sourceTemplate) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); done(); },
    onError: done,
  });

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>{started ? "Log Session" : "Start Workout"}</h1>
          <p>{started ? "Tick ✓ each set as you complete it" : "Start fresh or repeat a template"}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => nav("/previous-workouts")}>Cancel</button>
      </div>

      {!started ? (
        <StartChooser
          templates={templates.data ?? []} splits={splits.data ?? []} workouts={workouts.data ?? []}
          exercises={exercises.data ?? []} onEmpty={startEmpty} onTemplate={startFromTemplate}
        />
      ) : (
        <>
          <button className={`chip-toggle${deload ? " on" : ""}`} style={{ marginBottom: 14 }}
            onClick={() => setDeload((d) => !d)}>
            {deload ? "✓ Deload session" : "Mark as deload session"}
          </button>
          {deload && <p className="muted" style={{ fontSize: 12, margin: "-6px 0 14px" }}>Excluded from your progression charts & strength trajectory.</p>}

          {sessionMuscles.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 12 }}>
              <span className="micro">Still sore from recent training?</span>
              <p className="muted" style={{ fontSize: 11, margin: "2px 0 8px" }}>Helps ease your next session for those muscles.</p>
              <div className="chip-wrap">
                {sessionMuscles.map((m) => (
                  <button key={m} className={`chip-toggle${soreNow.includes(m) ? " on" : ""}`}
                    onClick={() => setSoreNow((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m])}>{muscleLabel(m)}</button>
                ))}
              </div>
            </div>
          )}
          {easedNotes.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 12, borderColor: "var(--ice)" }}>
              <span className="micro" style={{ color: "var(--ice)" }}>Eased today (readiness)</span>
              {easedNotes.map((e, i) => (
                <p key={i} className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{e.name} — {e.reason} → a set lighter, +1 RIR.</p>
              ))}
            </div>
          )}

          <div className="stagger">
            {blocks.map((b, i) => (
              <ExerciseBlockEditor
                key={b.key} block={b} bodyweight={bodyweight}
                prevSets={prevSetsFor(b.exercise.id)} prevReady={workouts.isSuccess}
                onChange={(sets) => setBlock(b.key, sets)} onRemove={() => removeBlock(b.key)}
                onExerciseChange={(ex) => setBlockExercise(b.key, ex)}
                onSetCompleted={(rs) => { if (restTimerEnabled) setRest({ at: Date.now(), target: rs ?? restTarget }); }}
                onSetUncompleted={() => setRest(null)}
                onMoveUp={i > 0 ? () => moveBlock(b.key, -1) : undefined}
                onMoveDown={i < blocks.length - 1 ? () => moveBlock(b.key, 1) : undefined}
                onNoteChange={(note) => setBlockNote(b.key, note)}
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

          <RestTimer start={rest?.at ?? null} target={rest?.target ?? 0} onDismiss={() => setRest(null)} />

          <div className="action-bar">
            <button className="btn btn-ghost grow" onClick={() => nav("/previous-workouts")}>Discard</button>
            <button className="btn btn-volt grow btn-lg" disabled={totalSets === 0 || save.isPending}
              onClick={onFinish}>
              {save.isPending ? "Saving…" : `Finish · ${doneSets}/${totalSets} done`}
            </button>
          </div>
        </>
      )}

      {confirmDiscard && (
        <div className="popup-backdrop" onClick={() => setConfirmDiscard(false)}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Sets not complete</span>
            <h3 style={{ fontSize: 20 }}>{totalSets - doneSets} unfinished set{totalSets - doneSets === 1 ? "" : "s"}</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Only sets you tick ✓ are saved. Finishing now discards the unticked sets (treated as not performed).
            </p>
            <button className="btn btn-ghost btn-block" onClick={() => setConfirmDiscard(false)}>Continue workout</button>
            <button className="btn btn-volt btn-block" onClick={discardAndFinish}>
              {doneSets > 0 ? `Discard & finish · ${doneSets} done` : "Discard workout"}
            </button>
          </div>
        </div>
      )}

      {dialog && (
        <div className="popup-backdrop" onClick={done}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Workout saved ✓</span>
            {dialog === "save-template" ? (
              <>
                <h3 style={{ fontSize: 20 }}>Save as a template?</h3>
                <p className="muted" style={{ fontSize: 13 }}>Reuse this lineup ({finishedBlocks().length} exercises) next time.</p>
                <input className="input mono" placeholder="Template name (e.g. Push Day)"
                  value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                <button className="btn btn-volt btn-block" disabled={!templateName.trim() || saveTemplate.isPending}
                  onClick={() => saveTemplate.mutate(templateName.trim())}>
                  {saveTemplate.isPending ? "Saving…" : "Save template"}
                </button>
                <button className="btn btn-ghost btn-block" onClick={done}>Skip</button>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 20 }}>Update “{cleanName(sourceTemplate?.name ?? "")}”?</h3>
                <p className="muted" style={{ fontSize: 13 }}>You changed exercises or set counts from the template.</p>
                <button className="btn btn-volt btn-block" disabled={updateTemplate.isPending}
                  onClick={() => updateTemplate.mutate()}>
                  {updateTemplate.isPending ? "Updating…" : "Update template"}
                </button>
                <button className="btn btn-ghost btn-block" onClick={done}>Keep as is</button>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
