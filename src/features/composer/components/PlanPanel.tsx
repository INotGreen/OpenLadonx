import Circle from "lucide-react/dist/esm/icons/circle";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import CircleDot from "lucide-react/dist/esm/icons/circle-dot";
import X from "lucide-react/dist/esm/icons/x";
import type { ReactNode } from "react";
import type { TurnPlan } from "../../../types";

type PlanPanelProps = {
  plan: TurnPlan | null;
  isProcessing: boolean;
  onClose?: () => void;
};

export function formatProgress(plan: TurnPlan) {
  const total = plan.steps.length;
  if (!total) {
    return "";
  }
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  return `${completed}/${total}`;
}

function statusLabel(status: TurnPlan["steps"][number]["status"]): ReactNode {
  if (status === "completed") {
    return <CircleCheck size={16} strokeWidth={1.8} />;
  }
  if (status === "inProgress") {
    return <CircleDot size={16} strokeWidth={1.8} />;
  }
  return <Circle size={16} strokeWidth={1.6} />;
}

export function PlanPanel({ plan, isProcessing, onClose }: PlanPanelProps) {
  const progress = plan ? formatProgress(plan) : "";
  const steps = plan?.steps ?? [];
  const showEmpty = !steps.length && !plan?.explanation;
  const emptyLabel = isProcessing ? "Waiting on a plan..." : "No active plan.";

  return (
    <aside className="plan-panel">
      <div className="plan-header">
        <span>Plan</span>
        <div className="plan-header-actions">
          {progress && <span className="plan-progress">{progress}</span>}
          {onClose && (
            <button
              type="button"
              className="plan-close-toggle"
              onClick={onClose}
              aria-label="Hide plan"
              title="Hide"
            >
              <X size={12} strokeWidth={1.6} />
            </button>
          )}
        </div>
      </div>
      {plan?.explanation && (
        <div className="plan-explanation">{plan.explanation}</div>
      )}
      {showEmpty ? (
        <div className="plan-empty">{emptyLabel}</div>
      ) : (
        <ol className="plan-list">
          {steps.map((step, index) => (
            <li key={`${step.step}-${index}`} className={`plan-step ${step.status}`}>
              <span className="plan-step-status" aria-hidden>
                {statusLabel(step.status)}
              </span>
              <span className="plan-step-text">{step.step}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
