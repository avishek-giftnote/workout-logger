import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import { blockLabel } from "../periodization";
import { muscleLabel } from "../muscles";
import { summarizePlan } from "../planSummary";
import type { MacrocycleDto } from "../api/types";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const GOAL_LABELS: Record<string, string> = {
  GENERAL_HYPERTROPHY: "Build muscle",
  MUSCLE_FOCUS: "Focus muscles",
  STRENGTH: "Strength",
  CONTEST_PREP: "Contest prep",
};

export function goalLabel(g: string | null | undefined): string {
  return (g && GOAL_LABELS[g]) ?? g ?? "—";
}

/** The goal label, or null when the plan name already contains it (auto-named plans are
 *  `"<goal> — <n> mo"`, so the standalone label would just be redundant). */
export function goalTag(plan: { name: string; goal: string | null | undefined }): string | null {
  if (!plan.goal) return null;
  const label = goalLabel(plan.goal);
  return plan.name.toLowerCase().includes(label.toLowerCase()) ? null : label;
}

interface Props {
  plan: MacrocycleDto;
}

/** Shared summary-card body — used by both CompletionScreen and PastPlans. */
export default function PlanSummaryCard({ plan }: Props) {
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: Api.listWorkouts });
  const exercises = useQuery({ queryKey: ["exercises"], queryFn: Api.listExercises });
  const me = useQuery({ queryKey: ["me"], queryFn: Api.me });

  const bodyweight = me.data?.bodyweightLog ?? [];

  if (workouts.isLoading || exercises.isLoading || me.isLoading) {
    return <div className="spinner" style={{ margin: "24px auto" }} />;
  }
  if (workouts.isError || exercises.isError || me.isError) {
    return <QueryError onRetry={() => { workouts.refetch(); exercises.refetch(); me.refetch(); }} />;
  }

  const s = summarizePlan(
    plan,
    workouts.data ?? [],
    exercises.data ?? [],
    bodyweight,
  );

  return (
    <>
      {/* date range + structural stats */}
      <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
        {fmtDate(s.startedAt)} → {fmtDate(s.endedAt)}
        {" · "}<span className="mono">{s.weeks}</span> weeks
        {" · "}<span className="mono">{s.blocks}</span> blocks
      </p>

      {/* block timeline */}
      <div className="plan-timeline" style={{ marginBottom: 14 }}>
        {plan.mesocycles.map((b, i) => (
          <div key={i} className="plan-block">
            <span className="tag" style={{ fontSize: 9 }}>{blockLabel(b.blockType)}</span>
            <b className="mono">{b.accumulationWeeks + 1}w</b>
            {b.focusMuscles.length > 0 && (
              <span className="micro" style={{ fontSize: 9 }}>{b.focusMuscles.map(muscleLabel).join("/")}</span>
            )}
          </div>
        ))}
      </div>

      {/* session / set / deload counts */}
      <p style={{ fontSize: 13, margin: "0 0 12px" }}>
        <span className="mono">{s.sessions}</span> sessions
        {" · "}<span className="mono">{s.hardSets}</span> hard sets
        {" · "}<span className="mono">{s.deloads}</span>{" "}
        {s.deloads === 1 ? "deload" : "deloads"}
      </p>

      {/* bodyweight delta — omit entirely when null */}
      {s.bodyweightDeltaKg !== null && (
        <p style={{ fontSize: 13, margin: "0 0 12px" }}>
          Bodyweight{" "}
          {s.bodyweightDeltaKg >= 0
            ? <span style={{ color: "var(--volt)" }}>+{s.bodyweightDeltaKg} kg</span>
            : <span style={{ color: "var(--ember)" }}>{s.bodyweightDeltaKg} kg</span>}
        </p>
      )}

      {/* strength gains */}
      <span className="micro" style={{ display: "block", marginBottom: 8 }}>
        Top strength gains (est. 1RM)
      </span>
      {s.strengthGains.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>No completed sessions logged.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
          {s.strengthGains.map((g) => (
            <div key={g.exerciseName} className="mvol-row" style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <span className="mvol-label" style={{ width: "auto", flex: 1, fontSize: 13 }}>{g.exerciseName}</span>
              <span className="mono" style={{ fontSize: 13 }}>
                {g.fromKg} → {g.toKg} kg
              </span>
              <span className="tag" style={{ marginLeft: 8, color: g.pct >= 0 ? "var(--volt)" : "var(--ember)" }}>
                {g.pct >= 0 ? "+" : ""}{g.pct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
