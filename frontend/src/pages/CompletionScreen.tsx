import { useNavigate } from "react-router-dom";
import type { MacrocycleDto } from "../api/types";
import PlanSummaryCard, { goalTag } from "./PlanSummaryCard";

interface Props {
  plan: MacrocycleDto;
  onStartNew: () => void;
  onPlanAgain: () => void;
  onDismiss: () => void;
}

export default function CompletionScreen({ plan, onStartNew, onPlanAgain, onDismiss }: Props) {
  const nav = useNavigate();

  return (
    <main className="screen">
      <div className="screen-head fade-up">
        <div>
          <h1 style={{ color: "var(--volt)" }}>✦ PLAN COMPLETE</h1>
          <p>
            {plan.name}
            {goalTag(plan) && <> — {goalTag(plan)}</>}
          </p>
        </div>
      </div>

      <div className="card card-pad fade-up" style={{ marginBottom: 16 }}>
        <PlanSummaryCard plan={plan} />
      </div>

      <div className="action-bar" style={{ flexWrap: "wrap", gap: 8 }}>
        <button className="btn btn-volt grow btn-lg" onClick={onStartNew}>
          Start a new plan
        </button>
        <button className="btn btn-ghost grow" onClick={onPlanAgain}>
          Plan again, same settings
        </button>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn btn-ghost grow" onClick={() => { nav("/past-plans"); }}>
          View past plans
        </button>
        <button className="btn btn-ghost grow" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </main>
  );
}
