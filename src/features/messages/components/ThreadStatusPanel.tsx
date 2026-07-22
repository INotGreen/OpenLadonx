import PanelTop from "lucide-react/dist/esm/icons/panel-top";
import { useTranslation } from "react-i18next";
import type { CollaborationModeOption, ConversationItem, ThreadGoal, ThreadTokenUsage, TurnPlan } from "../../../types";
import { PlanPanel, formatProgress } from "../../composer/components/PlanPanel";

type ThreadStatusMode = "plan" | "goal";

type ThreadStatusPanelProps = {
  plan: TurnPlan | null;
  goal?: ThreadGoal | null;
  items?: ConversationItem[];
  isProcessing: boolean;
  collaborationModes: CollaborationModeOption[];
  selectedCollaborationModeId: string | null;
  threadTitle?: string | null;
  tokenUsage?: ThreadTokenUsage | null;
};

function getThreadStatusMode(modes: CollaborationModeOption[], selectedModeId: string | null): ThreadStatusMode | null {
  if (!selectedModeId) return null;
  const mode = modes.find((entry) => entry.id === selectedModeId);
  const candidates = [
    selectedModeId,
    mode?.id,
    mode?.mode,
    mode?.label,
    mode?.value?.id,
    mode?.value?.mode,
    mode?.value?.label,
  ]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (candidates.some((value) => value === "plan" || value === "计划")) return "plan";
  if (candidates.some((value) => value === "goal" || value === "目标")) return "goal";
  return null;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function normalizeGoalStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase() || "active";
}

function getGoalStatusLabel(status: string | null | undefined, t: ReturnType<typeof useTranslation>["t"]) {
  const normalized = normalizeGoalStatus(status);
  if (normalized === "complete" || normalized === "completed") {
    return t("threadStatus.goalStatusComplete");
  }
  if (normalized === "blocked") {
    return t("threadStatus.goalStatusBlocked");
  }
  return t("threadStatus.goalStatusActive");
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function firstStringField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getGoalMessageFromStructuredText(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  const parsed = parseJsonObject(text);
  if (parsed) {
    return firstStringField(parsed, [
      "objective",
      "goal",
      "message",
      "summary",
      "description",
    ]);
  }
  return text;
}

function isGoalToolItem(item: ConversationItem): item is Extract<ConversationItem, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  const haystack = `${item.toolType} ${item.title} ${item.detail}`.toLowerCase();
  return (
    haystack.includes("create_goal") ||
    haystack.includes("update_goal") ||
    haystack.includes("get_goal")
  );
}

function getLatestGoalMessage(items: ConversationItem[] | undefined): string | undefined {
  if (!items?.length) {
    return undefined;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isGoalToolItem(item)) {
      continue;
    }
    const outputMessage = getGoalMessageFromStructuredText(item.output);
    if (outputMessage) {
      return outputMessage;
    }
    const detailMessage = getGoalMessageFromStructuredText(item.detail);
    if (detailMessage) {
      return detailMessage;
    }
  }
  return undefined;
}

function getPlanMessage(plan: TurnPlan | null): string | undefined {
  const message = plan?.explanation?.trim();
  return message ? message : undefined;
}

function GoalProgressPanel({ goal, isProcessing }: { goal?: ThreadGoal | null; isProcessing: boolean }) {
  const { t } = useTranslation();
  const statusLabel = getGoalStatusLabel(goal?.status, t);
  const tokensUsed = goal?.tokensUsed ?? null;
  const elapsedSeconds = goal?.timeUsedSeconds ?? null;
  const hasProgressData = Boolean(goal?.status || tokensUsed !== null || elapsedSeconds !== null);

  if (!hasProgressData) {
    return (
      <div className="thread-status-goal-progress-empty">
        {isProcessing ? t("threadStatus.goalProgressPending") : t("threadStatus.noMessage")}
      </div>
    );
  }

  return (
    <div className="thread-status-goal-progress">
      <div className="thread-status-goal-progress-row">
        <span>{t("threadStatus.goalProgressStatus")}</span>
        <span>{statusLabel}</span>
      </div>
      {tokensUsed !== null ? (
        <div className="thread-status-goal-progress-row">
          <span>{t("threadStatus.goalProgressTokens")}</span>
          <span>{formatTokenCount(tokensUsed)}</span>
        </div>
      ) : null}
      {elapsedSeconds !== null ? (
        <div className="thread-status-goal-progress-row">
          <span>{t("threadStatus.goalProgressTime")}</span>
          <span>{formatDuration(elapsedSeconds)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ThreadStatusPanel({
  plan,
  goal,
  items,
  isProcessing,
  collaborationModes,
  selectedCollaborationModeId,
  tokenUsage,
}: ThreadStatusPanelProps) {
  const { t } = useTranslation();
  const mode = getThreadStatusMode(collaborationModes, selectedCollaborationModeId);
  const hasPlan = Boolean(plan && (plan.steps.length > 0 || plan.explanation));
  const goalObjective = goal?.objective?.trim() || undefined;
  const latestGoalMessage = goalObjective ?? getLatestGoalMessage(items);
  if (!mode && !hasPlan && !latestGoalMessage) return null;

  const isGoal = Boolean(latestGoalMessage) || mode === "goal";
  const selectedMode = selectedCollaborationModeId
    ? collaborationModes.find((entry) => entry.id === selectedCollaborationModeId)
    : null;
  const detailTitle = isGoal ? t("threadStatus.goalTitle") : t("threadStatus.planTitle");
  const rawDetailMessage = isGoal
    ? latestGoalMessage
    : getPlanMessage(plan);
  const detailMessage = rawDetailMessage ?? t("threadStatus.noMessage");
  const visiblePlan = isGoal ? null : plan;
  const progress = visiblePlan ? formatProgress(visiblePlan) : "";
  const goalStatusLabel = isGoal ? getGoalStatusLabel(goal?.status, t) : "";
  const totalTokens = tokenUsage?.total.totalTokens ?? 0;

  return (
    <aside className="thread-status-panel" aria-label={t("threadStatus.ariaLabel")}>
      <div className="thread-status-card">
        <div className="thread-status-header">
          <div className="thread-status-title-row">
            <PanelTop className="thread-status-title-icon" aria-hidden />
            <span>{t("threadStatus.status")}</span>
          </div>
          <span className="thread-status-state">
            {isGoal
              ? goalStatusLabel
              : hasPlan && progress
              ? progress
              : isGoal || isProcessing
                ? t("threadStatus.stateActive")
                : t("threadStatus.stateReady")}
          </span>
        </div>
        <div className="thread-status-summary">
          <span>{isGoal ? t("threadStatus.goalMode") : selectedMode?.label ?? t("threadStatus.planMode")}</span>
          {totalTokens > 0 ? (
            <span>{t("threadStatus.tokens", { count: formatTokenCount(totalTokens) })}</span>
          ) : null}
        </div>
        <div className="thread-status-detail">
          <div className="thread-status-section-label">
            <span>{detailTitle}</span>
            <span className="thread-status-section-state">
              {isGoal || hasPlan ? t("threadStatus.stateActive") : t("threadStatus.stateReady")}
            </span>
          </div>
          <div className="thread-status-detail-body">
            {/* <DetailIcon className="thread-status-detail-icon" aria-hidden /> */}
            <div className="thread-status-detail-message">{detailMessage}</div>
          </div>
        </div>
        {!isGoal && (
          <div className="thread-status-progress">
            <div className="thread-status-section-label">{t("threadStatus.progress")}</div>
            <PlanPanel plan={visiblePlan} isProcessing={isProcessing} />
          </div>
        )}
        {isGoal && (
          <div className="thread-status-progress">
            <div className="thread-status-section-label">{t("threadStatus.progress")}</div>
            <GoalProgressPanel goal={goal} isProcessing={isProcessing} />
          </div>
        )}
      </div>
    </aside>
  );
}

export function hasThreadStatusPanelContent({
  plan,
  goal,
  items,
  collaborationModes,
  selectedCollaborationModeId,
}: Pick<ThreadStatusPanelProps, "plan" | "goal" | "items" | "collaborationModes" | "selectedCollaborationModeId">) {
  const hasPlan = Boolean(plan && (plan.steps.length > 0 || plan.explanation));
  const hasGoalMessage = Boolean(goal?.objective?.trim() || getLatestGoalMessage(items));
  return Boolean(getThreadStatusMode(collaborationModes, selectedCollaborationModeId) || hasPlan || hasGoalMessage);
}
