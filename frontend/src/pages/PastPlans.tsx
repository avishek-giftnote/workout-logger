import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Api } from "../api/client";
import QueryError from "../components/QueryError";
import type { MacrocycleDto } from "../api/types";
import PlanSummaryCard, { goalTag } from "./PlanSummaryCard";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function PastPlans() {
  const history = useQuery({ queryKey: ["plan", "history"], queryFn: Api.planHistory });
  const [expanded, setExpanded] = useState<string | null>(null);

  if (history.isLoading) return <main className="screen"><div className="spinner" /></main>;
  if (history.isError) return <QueryError onRetry={history.refetch} />;

  const plans = history.data ?? [];

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1>Past plans</h1>
          <p>{plans.length === 0 ? "No past plans yet." : `${plans.length} completed plan${plans.length !== 1 ? "s" : ""}`}</p>
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="muted" style={{ fontSize: 14, margin: "32px 4px" }}>No past plans yet.</p>
      ) : (
        <div className="stagger">
          {plans.map((plan) => (
            <PastPlanRow
              key={plan.id}
              plan={plan}
              expanded={expanded === plan.id}
              onToggle={() => setExpanded((prev) => (prev === plan.id ? null : plan.id))}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function PastPlanRow({ plan, expanded, onToggle }: { plan: MacrocycleDto; expanded: boolean; onToggle: () => void }) {
  const isCompleted = plan.status === "COMPLETED";
  const endDate = plan.completedAt ?? plan.endedAt;

  return (
    <section className="card ex-block" style={{ marginBottom: 10 }}>
      <button
        className="ex-head"
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        onClick={onToggle}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>{plan.name}</h3>
          {goalTag(plan) && <span className="tag">{goalTag(plan)}</span>}
          <span
            className="tag"
            style={{ color: isCompleted ? "var(--volt)" : "var(--muted)", borderColor: isCompleted ? "var(--volt)" : undefined }}
          >
            {isCompleted ? "Completed" : "Ended early"}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {fmtDate(plan.startedAt)}{endDate ? ` → ${fmtDate(endDate)}` : ""}
        </span>
        <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
          {plan.mesocycles.length} blocks
        </span>
        <span className="micro" style={{ marginLeft: 8 }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "12px 16px 8px", borderTop: "1px solid var(--line)" }}>
          <PlanSummaryCard plan={plan} />
        </div>
      )}
    </section>
  );
}
