import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "../api/client";
import type { CreateWorkoutRequest, ExerciseDto, WorkoutDto } from "../api/types";
import {
  DraftBlock, ExerciseBlockEditor, ExercisePicker, filledSet, findEx, toCreateSet, uid,
} from "../logging/engine";
import { useSettings } from "../settings";

function workoutToBlocks(w: WorkoutDto, catalog: ExerciseDto[]): DraftBlock[] {
  return w.exercises.map((b) => {
    const cat = catalog.find((e) => e.id === b.exerciseId);
    const isBw = cat?.isBodyweight ?? b.sets.some((s) => s.loadMode != null);
    const exercise: ExerciseDto = { ...findEx(catalog, b.exerciseId, b.name), isBodyweight: isBw };
    return { key: uid(), exercise, sets: b.sets.map((s) => filledSet(s, isBw)) };
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
  const { showRpe } = useSettings();
  const bodyweight = me.data?.currentBodyweightKg ?? "";

  // Populate the editor once the workout + catalog have loaded.
  useEffect(() => {
    if (blocks === null && workout.data && exercises.isSuccess) {
      setBlocks(workoutToBlocks(workout.data, exercises.data ?? []));
    }
  }, [blocks, workout.data, exercises.isSuccess, exercises.data]);

  const setBlock = (key: string, sets: DraftBlock["sets"]) =>
    setBlocks((bs) => (bs ?? []).map((b) => (b.key === key ? { ...b, sets } : b)));
  const setBlockExercise = (key: string, exercise: ExerciseDto) =>
    setBlocks((bs) => (bs ?? []).map((b) => (b.key === key ? { ...b, exercise } : b)));
  const removeBlock = (key: string) => setBlocks((bs) => (bs ?? []).filter((b) => b.key !== key));
  const addExercise = (ex: ExerciseDto) => {
    setBlocks((bs) => (bs ?? []).some((b) => b.exercise.id === ex.id) ? bs : [...(bs ?? []), { key: uid(), exercise: ex, sets: [] }]);
    setPicking(false);
  };

  const save = useMutation({
    mutationFn: () => {
      const w = workout.data!;
      const body: CreateWorkoutRequest = {
        startedAt: w.startedAt,
        templateId: w.templateId ?? undefined,
        exercises: (blocks ?? []).map((b, i) => ({
          exerciseId: b.exercise.id, name: b.exercise.name, position: i,
          sets: b.sets.map((s, j) => toCreateSet(s, j, b.exercise.isBodyweight, bodyweight, showRpe)),
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

      <div className="stagger">
        {blocks.map((b) => (
          <ExerciseBlockEditor
            key={b.key} block={b} bodyweight={bodyweight} prevSets={null} prevReady showLast={false}
            onChange={(sets) => setBlock(b.key, sets)} onRemove={() => removeBlock(b.key)}
            onExerciseChange={(ex) => setBlockExercise(b.key, ex)}
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
