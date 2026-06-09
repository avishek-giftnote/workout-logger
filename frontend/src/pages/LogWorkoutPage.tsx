import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api, ApiError } from "../api/client";
import type { CreateWorkoutRequest, ExerciseDto, SplitDto, TemplateDto, WorkoutDto } from "../api/types";
import {
  DraftBlock, ExerciseBlockEditor, ExercisePicker, findEx, structureChanged,
  templateExercisesFromBlocks, toCreateSet, uid,
} from "../logging/engine";

const cleanName = (n: string) => n.replace(/\s*focus/i, "").trim();

const blocksFromTemplate = (t: TemplateDto, catalog: ExerciseDto[]): DraftBlock[] =>
  t.exercises.map((te) => ({ key: uid(), exercise: findEx(catalog, te.exerciseId, te.name), sets: [] }));

export default function LogWorkoutPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const templates = useQuery({ queryKey: ["templates"], queryFn: Api.listTemplates });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const splits = useQuery({ queryKey: ["splits"], queryFn: Api.listSplits });

  const [started, setStarted] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<DraftBlock[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "save-template" | "update-template">(null);
  const [templateName, setTemplateName] = useState("");
  const startedAt = useMemo(() => new Date(), []);
  const bodyweight = me.data?.currentBodyweightKg ?? "";
  const sourceTemplate = templates.data?.find((t) => t.id === templateId) ?? null;
  const done = () => nav("/previous-workouts");

  const prevSetsFor = (exerciseId: string) => {
    for (const w of workouts.data ?? []) {
      const b = w.exercises.find((e) => e.exerciseId === exerciseId);
      if (b) return b.sets;
    }
    return null;
  };

  const setBlock = (key: string, sets: DraftBlock["sets"]) =>
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workouts"] });
      if (!templateId && blocks.length) { setTemplateName(""); setDialog("save-template"); }
      else if (sourceTemplate && structureChanged(sourceTemplate, blocks)) setDialog("update-template");
      else done();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save workout."),
  });

  const saveTemplate = useMutation({
    mutationFn: (name: string) => Api.createTemplate({ name, exercises: templateExercisesFromBlocks(blocks) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); done(); },
    onError: done,
  });
  const updateTemplate = useMutation({
    mutationFn: () => Api.updateTemplate(sourceTemplate!.id,
      { name: sourceTemplate!.name, exercises: templateExercisesFromBlocks(blocks) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); done(); },
    onError: done,
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
        <button className="btn btn-ghost" onClick={() => nav("/previous-workouts")}>Cancel</button>
      </div>

      {!bodyweight && <BodyweightSetter />}

      {!started ? (
        <StartChooser
          templates={templates.data ?? []} splits={splits.data ?? []} workouts={workouts.data ?? []}
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
            <button className="btn btn-ghost grow" onClick={() => nav("/previous-workouts")}>Discard</button>
            <button className="btn btn-volt grow btn-lg" disabled={totalSets === 0 || save.isPending}
              onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : `Finish · ${totalSets} sets`}
            </button>
          </div>
        </>
      )}

      {dialog && (
        <div className="popup-backdrop" onClick={done}>
          <div className="popup-card" onClick={(e) => e.stopPropagation()}>
            <span className="micro">Workout saved ✓</span>
            {dialog === "save-template" ? (
              <>
                <h3 style={{ fontSize: 20 }}>Save as a template?</h3>
                <p className="muted" style={{ fontSize: 13 }}>Reuse this lineup ({blocks.length} exercises) next time.</p>
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

/* ---------------------------------------------------------------- start chooser (with splits) */
function StartChooser({ templates, splits, workouts, onEmpty, onTemplate }: {
  templates: TemplateDto[]; splits: SplitDto[]; workouts: WorkoutDto[];
  onEmpty: () => void; onTemplate: (t: TemplateDto) => void;
}) {
  const [editing, setEditing] = useState<SplitDto | "new" | null>(null);
  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);
  const grouped = new Set(splits.flatMap((s) => s.templateIds));
  const ungrouped = templates.filter((t) => !grouped.has(t.id));
  const lastFor = (id: string) =>
    workouts.filter((w) => w.templateId === id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

  const TemplateCard = (t: TemplateDto) => {
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
            {prev ? `last: ${new Date(prev.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "no history yet"}
          </div>
        </div>
        <div className="w-stat"><span className="readout" style={{ color: "var(--volt)" }}>›</span></div>
      </button>
    );
  };

  return (
    <div className="mt">
      <button className="card w-item fade-up" onClick={onEmpty}>
        <div className="w-date"><span className="d" style={{ color: "var(--volt)" }}>+</span></div>
        <div className="w-meta"><h3>Empty session</h3><div className="sub">Start fresh, add exercises as you go</div></div>
        <div className="w-stat"><span className="micro">blank</span></div>
      </button>

      {splits.map((s) => (
        <div key={s.id} className="mt">
          <div className="spread" style={{ margin: "20px 4px 10px" }}>
            <span className="micro">{s.name} · {s.templateIds.length} templates</span>
            <button className="micro" style={{ background: "none", border: "none", color: "var(--volt)", cursor: "pointer" }}
              onClick={() => setEditing(s)}>edit</button>
          </div>
          <div className="w-list">
            {s.templateIds.map((id) => byId.get(id)).filter(Boolean).map((t) => TemplateCard(t as TemplateDto))}
            {s.templateIds.length === 0 && <p className="muted" style={{ fontSize: 13, padding: "0 4px" }}>No templates yet — tap edit to add some.</p>}
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div className="mt">
          <p className="micro" style={{ margin: "20px 4px 10px" }}>{splits.length ? "Other templates" : "Templates"}</p>
          <div className="w-list">{ungrouped.map(TemplateCard)}</div>
        </div>
      )}

      <button className="btn btn-ghost btn-block mt" onClick={() => setEditing("new")}>+ New split</button>

      {editing && (
        <SplitEditor split={editing === "new" ? null : editing} templates={templates} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- split editor (create / edit) */
function SplitEditor({ split, templates, onClose }: {
  split: SplitDto | null; templates: TemplateDto[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(split?.name ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(split?.templateIds ?? []));
  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const close = () => { qc.invalidateQueries({ queryKey: ["splits"] }); onClose(); };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), templateIds: [...picked] };
      return split ? Api.updateSplit(split.id, body) : Api.createSplit(body);
    },
    onSuccess: close,
  });
  const del = useMutation({ mutationFn: () => Api.deleteSplit(split!.id), onSuccess: close });

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <span className="micro">{split ? "Edit split" : "New split"}</span>
        <input className="input mono" placeholder="Split name (e.g. Anterior/Posterior)"
          value={name} onChange={(e) => setName(e.target.value)} />
        <span className="micro" style={{ marginTop: 6 }}>Templates in this split</span>
        <div style={{ maxHeight: 260, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {templates.map((t) => (
            <button key={t.id} className={`popup-opt${picked.has(t.id) ? " on" : ""}`} onClick={() => toggle(t.id)}>
              {picked.has(t.id) ? "✓ " : ""}{cleanName(t.name)}
            </button>
          ))}
          {templates.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No templates yet.</p>}
        </div>
        <button className="btn btn-volt btn-block" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : split ? "Save changes" : "Create split"}
        </button>
        {split && (
          <button className="btn btn-ghost btn-block btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>
            Delete split
          </button>
        )}
        <button className="btn btn-ghost btn-block" onClick={onClose}>Cancel</button>
      </div>
    </div>
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
