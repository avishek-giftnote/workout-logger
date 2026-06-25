import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import { equipmentLabel } from "../logging/engine";

type Sort = "alpha" | "recent" | "frequency";
const SORTS: { value: Sort; label: string }[] = [
  { value: "alpha", label: "A–Z" },
  { value: "recent", label: "Recent" },
  { value: "frequency", label: "Most done" },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function ExerciseListPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("alpha");
  const restore = useMutation({
    mutationFn: Api.restoreDefaultExercises,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exercises"] }),
  });

  // Per-exercise stats: how many sessions it appears in, and the most recent date.
  const stats = useMemo(() => {
    const m = new Map<string, { last: string | null; count: number }>();
    for (const w of workouts.data ?? []) {
      const seen = new Set<string>();
      for (const b of w.exercises) {
        if (seen.has(b.exerciseId)) continue;
        seen.add(b.exerciseId);
        const cur = m.get(b.exerciseId) ?? { last: null, count: 0 };
        cur.count += 1;
        if (!cur.last || w.startedAt > cur.last) cur.last = w.startedAt;
        m.set(b.exerciseId, cur);
      }
    }
    return m;
  }, [workouts.data]);

  const rows = useMemo(() => {
    const list = (exercises.data ?? []).filter((e) => e.name.toLowerCase().includes(q.toLowerCase()));
    const st = (id: string) => stats.get(id) ?? { last: null, count: 0 };
    const sorted = [...list];
    if (sort === "alpha") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "frequency") sorted.sort((a, b) => st(b.id).count - st(a.id).count || a.name.localeCompare(b.name));
    else sorted.sort((a, b) => (st(b.id).last ?? "").localeCompare(st(a.id).last ?? "") || a.name.localeCompare(b.name));
    return sorted;
  }, [exercises.data, stats, q, sort]);

  if (exercises.isError) return <QueryError onRetry={exercises.refetch} />;

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Exercises</h1>
          <p>{(exercises.data ?? []).length} exercises</p>
        </div>
        <button className="btn btn-ghost" disabled={restore.isPending} title="Add any default exercises you're missing"
          onClick={() => restore.mutate()}>{restore.isPending ? "…" : "+ Defaults"}</button>
      </div>

      {restore.isSuccess && (
        <p className="muted" style={{ fontSize: 12, margin: "0 4px 10px" }}>
          {restore.data.added > 0 ? `Added ${restore.data.added} default exercise${restore.data.added === 1 ? "" : "s"}.` : "Your catalog already has all the defaults."}
        </p>
      )}

      <input className="input mono" placeholder="Search exercises…" value={q}
        onChange={(e) => setQ(e.target.value)} />

      <div className="seg" style={{ marginTop: 12, width: "100%" }}>
        {SORTS.map((s) => (
          <button key={s.value} className={sort === s.value ? "on" : ""} style={{ flex: 1 }}
            onClick={() => setSort(s.value)}>{s.label}</button>
        ))}
      </div>

      {exercises.isLoading && <div className="spinner" />}

      <div className="w-list stagger mt">
        {rows.map((e) => {
          const s = stats.get(e.id) ?? { last: null, count: 0 };
          return (
            <div key={e.id} className="card ex-row" style={{ cursor: "pointer" }}
              onClick={() => nav(`/exercise-list/${e.id}`)}>
              <div className="grow">
                <h3>{e.name}</h3>
                <div className="sub">
                  {s.count > 0 ? `performed ${s.count}×` : "not performed yet"}
                  {s.last ? ` · last ${fmtDate(s.last)}` : ""}
                </div>
              </div>
              <span className={`tag${e.equipment === "BODYWEIGHT" ? " tag-bw" : ""}`}>{equipmentLabel(e.equipment)}</span>
            </div>
          );
        })}
        {rows.length === 0 && !exercises.isLoading && (
          <div className="empty"><div className="big">No matches</div></div>
        )}
      </div>
    </main>
  );
}
