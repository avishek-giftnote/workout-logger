import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import type { ExerciseDto, SplitDto, TemplateDto, TemplateExerciseInput, WorkoutDto } from "../api/types";

const cleanName = (n: string) => n.replace(/\s*focus/i, "").trim();

const COLLAPSE_KEY = "wl.collapsedSplits";
function useCollapsed() {
  const [ids, setIds] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { return new Set(); }
  });
  const toggle = (id: string) => setIds((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n]));
    return n;
  });
  return { ids, toggle };
}

export default function StartChooser({ templates, splits, workouts, exercises, onEmpty, onTemplate }: {
  templates: TemplateDto[]; splits: SplitDto[]; workouts: WorkoutDto[]; exercises: ExerciseDto[];
  onEmpty: () => void; onTemplate: (t: TemplateDto) => void;
}) {
  const [editing, setEditing] = useState<SplitDto | "new" | null>(null);
  const [tq, setTq] = useState("");
  const collapsed = useCollapsed();
  const byId = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  const lastUsed = (id: string) =>
    workouts.filter((w) => w.templateId === id).map((w) => w.startedAt).sort().slice(-1)[0] ?? "";

  const TemplateCard = (t: TemplateDto) => {
    const lu = lastUsed(t.id);
    return (
      <button key={t.id} className="card w-item" onClick={() => onTemplate(t)}>
        <div className="w-date">
          <span className="d" style={{ fontSize: 20 }}>{t.exercises.length}</span>
          <span className="m">moves</span>
        </div>
        <div className="w-meta">
          <h3>{cleanName(t.name)}</h3>
          <div className="sub">{lu ? `last: ${new Date(lu).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "no history yet"}</div>
        </div>
        <div className="w-stat"><span className="readout" style={{ color: "var(--volt)" }}>›</span></div>
      </button>
    );
  };

  const allSorted = useMemo(() => {
    return [...templates]
      .filter((t) => cleanName(t.name).toLowerCase().includes(tq.toLowerCase()))
      .sort((a, b) => lastUsed(b.id).localeCompare(lastUsed(a.id)) || cleanName(a.name).localeCompare(cleanName(b.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, workouts, tq]);

  return (
    <div className="mt">
      <button className="card w-item fade-up" onClick={onEmpty}>
        <div className="w-date"><span className="d" style={{ color: "var(--volt)" }}>+</span></div>
        <div className="w-meta"><h3>Empty session</h3><div className="sub">Start fresh, add exercises as you go</div></div>
        <div className="w-stat"><span className="micro">blank</span></div>
      </button>

      {splits.map((s) => {
        const isCollapsed = collapsed.ids.has(s.id);
        return (
          <div key={s.id} className="mt">
            <div className="split-head">
              <button className="split-toggle" onClick={() => collapsed.toggle(s.id)}>
                <span className={`chev${isCollapsed ? "" : " open"}`} />
                {s.name} <span className="muted">· {s.templateIds.length}</span>
              </button>
              <button className="micro" style={{ background: "none", border: "none", color: "var(--volt)", cursor: "pointer" }}
                onClick={() => setEditing(s)}>edit</button>
            </div>
            {!isCollapsed && (
              <div className="w-list">
                {s.templateIds.map((id) => byId.get(id)).filter(Boolean).map((t) => TemplateCard(t as TemplateDto))}
                {s.templateIds.length === 0 && <p className="muted" style={{ fontSize: 13, padding: "0 4px" }}>No templates yet — tap edit to add some.</p>}
              </div>
            )}
          </div>
        );
      })}

      <button className="btn btn-ghost btn-block mt" onClick={() => setEditing("new")}>+ New split</button>

      <p className="micro" style={{ margin: "26px 4px 10px" }}>All templates · latest used</p>
      <input className="input mono" placeholder="Search templates…" value={tq} onChange={(e) => setTq(e.target.value)} />
      <div className="w-list mt">
        {allSorted.map(TemplateCard)}
        {allSorted.length === 0 && <p className="muted" style={{ fontSize: 13, padding: "0 4px" }}>No templates match.</p>}
      </div>

      {editing && (
        <SplitEditor split={editing === "new" ? null : editing} templates={templates} exercises={exercises}
          onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- split editor (+ inline template builder) */
function SplitEditor({ split, templates, exercises, onClose }: {
  split: SplitDto | null; templates: TemplateDto[]; exercises: ExerciseDto[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(split?.name ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(split?.templateIds ?? []));
  const [building, setBuilding] = useState(false);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const close = () => { qc.invalidateQueries({ queryKey: ["splits"] }); onClose(); };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), templateIds: [...picked] };
      return split ? Api.updateSplit(split.id, body) : Api.createSplit(body);
    },
    onSuccess: close,
  });
  const del = useMutation({ mutationFn: () => Api.deleteSplit(split!.id), onSuccess: close });

  if (building) {
    return (
      <div className="popup-backdrop" onClick={onClose}>
        <div className="popup-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <TemplateBuilder exercises={exercises}
            onCreated={(t) => { setPicked((p) => new Set(p).add(t.id)); setBuilding(false); }}
            onCancel={() => setBuilding(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="popup-backdrop" onClick={onClose}>
      <div className="popup-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <span className="micro">{split ? "Edit split" : "New split"}</span>
        <input className="input mono" placeholder="Split name (e.g. Anterior/Posterior)"
          value={name} onChange={(e) => setName(e.target.value)} />
        <span className="micro" style={{ marginTop: 6 }}>Templates in this split</span>
        <div style={{ maxHeight: 240, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {templates.map((t) => (
            <button key={t.id} className={`popup-opt${picked.has(t.id) ? " on" : ""}`} onClick={() => toggle(t.id)}>
              {picked.has(t.id) ? "✓ " : ""}{cleanName(t.name)}
            </button>
          ))}
          {templates.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No templates yet.</p>}
        </div>
        <button className="btn btn-ghost btn-block" onClick={() => setBuilding(true)}>+ New template</button>
        <button className="btn btn-volt btn-block" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : split ? "Save changes" : "Create split"}
        </button>
        {split && (
          <button className="btn btn-ghost btn-block btn-danger" disabled={del.isPending} onClick={() => del.mutate()}>Delete split</button>
        )}
        <button className="btn btn-ghost btn-block" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- template builder (name + exercises + sets) */
function TemplateBuilder({ exercises, onCreated, onCancel }: {
  exercises: ExerciseDto[]; onCreated: (t: TemplateDto) => void; onCancel: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [rows, setRows] = useState<{ ex: ExerciseDto; sets: number }[]>([]);
  const [q, setQ] = useState("");
  const chosen = new Set(rows.map((r) => r.ex.id));
  const matches = q.trim()
    ? exercises.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) && !chosen.has(e.id)).slice(0, 6)
    : [];

  const add = (ex: ExerciseDto) => { setRows((r) => [...r, { ex, sets: 3 }]); setQ(""); };
  const bump = (id: string, d: number) => setRows((r) => r.map((x) => x.ex.id === id ? { ...x, sets: Math.max(1, x.sets + d) } : x));
  const remove = (id: string) => setRows((r) => r.filter((x) => x.ex.id !== id));

  const create = useMutation({
    mutationFn: () => {
      const exs: TemplateExerciseInput[] = rows.map((r, i) => ({ exerciseId: r.ex.id, name: r.ex.name, position: i, sets: r.sets }));
      return Api.createTemplate({ name: name.trim(), exercises: exs });
    },
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ["templates"] }); onCreated(t); },
  });

  return (
    <>
      <span className="micro">New template</span>
      <input className="input mono" placeholder="Template name (e.g. Push Day)" value={name} onChange={(e) => setName(e.target.value)} />

      {rows.map((r) => (
        <div key={r.ex.id} className="tb-row">
          <span className="grow">{r.ex.name}</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="bw-mode" onClick={() => bump(r.ex.id, -1)}>−</button>
            <span className="readout" style={{ minWidth: 44, textAlign: "center" }}>{r.sets} sets</span>
            <button className="bw-mode" onClick={() => bump(r.ex.id, 1)}>+</button>
            <button className="icon-btn" onClick={() => remove(r.ex.id)}>×</button>
          </div>
        </div>
      ))}

      <input className="input mono" placeholder="Add exercise…" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.map((e) => (
        <button key={e.id} className="popup-opt" onClick={() => add(e)}>{e.name}</button>
      ))}

      <button className="btn btn-volt btn-block" disabled={!name.trim() || rows.length === 0 || create.isPending}
        onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create template"}</button>
      <button className="btn btn-ghost btn-block" onClick={onCancel}>Back</button>
    </>
  );
}
