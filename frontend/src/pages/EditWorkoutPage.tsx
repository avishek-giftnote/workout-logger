import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "../api/client";
import type { CreateWorkoutRequest, ExerciseDto, Muscle, WorkoutDto } from "../api/types";
import {
  DraftBlock, ExerciseBlockEditor, ExercisePicker, filledSet, findEx, isCardioEx, toCreateSet, uid,
} from "../logging/engine";
import { useSettings } from "../settings";
import { muscleLabel } from "../muscles";

function workoutToBlocks(w: WorkoutDto, catalog: ExerciseDto[]): DraftBlock[] {
  return w.exercises.map((b) => {
    const cat = catalog.find((e) => e.id === b.exerciseId);
    const isBw = cat?.isBodyweight ?? b.sets.some((s) => s.loadMode != null);
    const exercise: ExerciseDto = { ...findEx(catalog, b.exerciseId, b.name), isBodyweight: isBw };
    return { key: uid(), exercise, sets: b.sets.map((s) => filledSet(s, isBw)), note: b.note ?? undefined };
  });
}

export default function EditWorkoutPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workout = useQuery({ queryKey: ["workout", id], queryFn: () => Api.getWorkout(id) });

  const [blocks, setBlocks] = useState<DraftBlock[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deload, setDeload] = useState(false);
  const [sore, setSore] = useState<Muscle[]>([]);
  const { showRpe } = useSettings();
  const bodyweight = me.data?.currentBodyweightKg ?? "";

  // Populate the editor (incl. deload flag + soreness report) once the workout + catalog have loaded.
  useEffect(() => {
    if (blocks === null && workout.data && exercises.isSuccess) {
      setBlocks(workoutToBlocks(workout.data, exercises.data ?? []));
      setDeload(workout.data.cyclePhase === "DELOAD");
      setSore(workout.data.soreMuscles ?? []);
    }
  }, [blocks, workout.data, exercises.isSuccess, exercises.data]);

  const primaryMuscleOf = (id: string): Muscle | null =>
    findEx(exercises.data ?? [], id, "").muscleContributions.find((c) => parseFloat(c.fraction) >= 0.5)?.muscle ?? null;
  const sessionMuscles = [...new Set((blocks ?? []).map((b) => primaryMuscleOf(b.exercise.id)).filter((m): m is Muscle => !!m))];

  const setBlock = (key: string, sets: DraftBlock["sets"]) =>
    setBlocks((bs) => (bs ?? []).map((b) => (b.key === key ? { ...b, sets } : b)));
  const setBlockExercise = (key: string, exercise: ExerciseDto) =>
    setBlocks((bs) => (bs ?? []).map((b) => (b.key === key ? { ...b, exercise } : b)));
  const setBlockNote = (key: string, note: string) =>
    setBlocks((bs) => (bs ?? []).map((b) => (b.key === key ? { ...b, note } : b)));
  const removeBlock = (key: string) => setBlocks((bs) => (bs ?? []).filter((b) => b.key !== key));
  const moveBlock = (key: string, dir: -1 | 1) => setBlocks((bs) => {
    const arr = bs ?? []; const i = arr.findIndex((b) => b.key === key), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return bs;
    const next = [...arr]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const addExercise = (ex: ExerciseDto) => {
    setBlocks((bs) => (bs ?? []).some((b) => b.exercise.id === ex.id) ? bs : [...(bs ?? []), { key: uid(), exercise: ex, sets: [] }]);
    setPicking(false);
  };

  const save = useMutation({
    mutationFn: () => {
      const w = workout.data!;
      const body: CreateWorkoutRequest = {
        startedAt: w.startedAt,
        durationSeconds: w.durationSeconds ?? undefined,
        templateId: w.templateId ?? undefined,
        cyclePhase: deload ? "DELOAD" : undefined,
        soreMuscles: sore.length ? sore : undefined,
        exercises: (blocks ?? []).map((b, i) => ({
          exerciseId: b.exercise.id, name: b.exercise.name, position: i, note: b.note?.trim() || undefined,
          sets: b.sets.map((s, j) => toCreateSet(s, j, b.exercise.isBodyweight, bodyweight, showRpe, isCardioEx(b.exercise))),
        })),
      };
      return Api.updateWorkout(id, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workouts"] });
      qc.invalidateQueries({ queryKey: ["workout", id] });
      nav(`/previous-workouts/${id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save changes."),
  });

  if (workout.isLoading || blocks === null) return <main className="screen"><div className="spinner" /></main>;
  const totalSets = blocks.reduce((n, b) => n + b.sets.length, 0);

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <button className="micro" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
            onClick={() => nav(`/previous-workouts/${id}`)}>← Cancel edit</button>
          <h1>Edit Session</h1>
          <p>Change weights, reps, RPE, sets, or exercises</p>
        </div>
      </div>

      <button className={`chip-toggle${deload ? " on" : ""}`} style={{ marginBottom: 12 }}
        onClick={() => setDeload((d) => !d)}>{deload ? "✓ Deload session" : "Mark as deload session"}</button>
      {sessionMuscles.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <span className="micro">Sore muscles reported at this session</span>
          <div className="chip-wrap" style={{ marginTop: 6 }}>
            {sessionMuscles.map((m) => (
              <button key={m} className={`chip-toggle${sore.includes(m) ? " on" : ""}`}
                onClick={() => setSore((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m])}>{muscleLabel(m)}</button>
            ))}
          </div>
        </div>
      )}

      <div className="stagger">
        {blocks.map((b, i) => (
          <ExerciseBlockEditor
            key={b.key} block={b} bodyweight={bodyweight} prevSets={null} prevReady showLast={false}
            onChange={(sets) => setBlock(b.key, sets)} onRemove={() => removeBlock(b.key)}
            onExerciseChange={(ex) => setBlockExercise(b.key, ex)}
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

      <div className="action-bar">
        <button className="btn btn-ghost grow" onClick={() => nav(`/previous-workouts/${id}`)}>Cancel</button>
        <button className="btn btn-volt grow btn-lg" disabled={totalSets === 0 || save.isPending}
          onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </main>
  );
}
