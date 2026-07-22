import { useEffect, useMemo } from "react";
import type { ApprovalRequest, WorkspaceInfo } from "../../../types";
import { getApprovalCommandInfo } from "../../../utils/approvalRules";
import { useI18nSafe } from "../../../hooks/useI18nSafe";
import {
  ToastActions,
  ToastBody,
  ToastCard,
  ToastHeader,
  ToastTitle,
  ToastViewport,
} from "../../design-system/components/toast/ToastPrimitives";

type ApprovalToastsProps = {
  approvals: ApprovalRequest[];
  workspaces: WorkspaceInfo[];
  onDecision: (request: ApprovalRequest, decision: "accept" | "decline") => void;
  onRemember?: (request: ApprovalRequest, command: string[]) => void;
};

const SUMMARY_PARAM_LIMIT = 3;
const HIDDEN_VALUE_MAX_LENGTH = 120;
const COMMAND_KEYS = new Set([
  "argv",
  "args",
  "command",
  "cmd",
  "exec",
  "shellCommand",
  "script",
  "proposedExecPolicyAmendment",
  "proposed_exec_policy_amendment",
]);
const HIDDEN_SUMMARY_KEYS = new Set([
  // Hide internal path/request metadata from approval toasts.
  "cwd",
  "workdir",
  "item_id",
  "itemId",
  "request_id",
  "requestId",
  "started_at_ms",
  "startedAtMs",
  "thread_id",
  "threadId",
  "turn_id",
  "turnId",
]);
const PRIORITY_KEYS = [
  "justification",
  "reason",
  "description",
  "prompt",
  "path",
  // "cwd",
  // "workdir",
  "sandbox_permissions",
];

export function ApprovalToasts({
  approvals,
  workspaces,
  onDecision,
  onRemember,
}: ApprovalToastsProps) {
  const { t } = useI18nSafe();
  const workspaceLabels = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  const primaryRequest = approvals[approvals.length - 1];

  useEffect(() => {
    if (!primaryRequest) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        return;
      }
      event.preventDefault();
      onDecision(primaryRequest, "accept");
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onDecision, primaryRequest]);

  if (!approvals.length) {
    return null;
  }

  const formatLabel = (value: string) =>
    value
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .trim();

  const methodLabel = (method: string) => {
    const trimmed = method.replace(/^codex\/requestApproval\/?/, "");
    return trimmed || method;
  };

  const renderInlineValue = (value: unknown) => {
    if (value === null || value === undefined) {
      return String(t("approvalToasts.none"));
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      if (value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
        return value.map(String).join(", ");
      }
      return JSON.stringify(value);
    }
    return JSON.stringify(value);
  };

  const truncateInlineValue = (value: string) =>
    value.length > HIDDEN_VALUE_MAX_LENGTH ? `${value.slice(0, HIDDEN_VALUE_MAX_LENGTH - 3)}...` : value;

  const getSummaryEntries = (params: Record<string, unknown>) => {
    const allEntries = Object.entries(params).filter(
      ([key]) => !COMMAND_KEYS.has(key) && !HIDDEN_SUMMARY_KEYS.has(key),
    );
    const prioritizedEntries = PRIORITY_KEYS.flatMap((key) => {
      const match = allEntries.find(([entryKey]) => entryKey === key);
      return match ? [match] : [];
    });
    const fallbackEntries = allEntries.filter(
      ([key]) => !PRIORITY_KEYS.includes(key) && ["string", "number", "boolean"].includes(typeof params[key]),
    );
    const visibleEntries = [...prioritizedEntries, ...fallbackEntries].slice(0, SUMMARY_PARAM_LIMIT);

    return visibleEntries.map(([key, value]) => ({
      key,
      label: formatLabel(key),
      fullValue: renderInlineValue(value),
      value: truncateInlineValue(renderInlineValue(value)),
    }));
  };

  return (
    <ToastViewport className="approval-toasts" role="region" ariaLive="assertive">
      {approvals.map((request) => {
        const workspaceName = workspaceLabels.get(request.workspace_id);
        const params = request.params ?? {};
        const commandInfo = getApprovalCommandInfo(params);
        const summaryEntries = getSummaryEntries(params);
        return (
          <ToastCard
            key={`${request.workspace_id}-${request.request_id}`}
            className="approval-toast"
            role="alert"
          >
            <ToastHeader className="approval-toast-header">
              <ToastTitle className="approval-toast-title">
                {String(t("approvalToasts.approvalNeeded"))}
              </ToastTitle>
              {workspaceName ? (
                <div className="approval-toast-workspace">{workspaceName}</div>
              ) : null}
            </ToastHeader>
            <div className="approval-toast-method">{methodLabel(request.method)}</div>
            <div className="approval-toast-details">
              {commandInfo ? (
                <div className="approval-toast-detail">
                  <div className="approval-toast-detail-label">
                    {String(t("approvalToasts.command"))}
                  </div>
                  <code
                    className="approval-toast-command"
                    title={commandInfo.preview}
                  >
                    {commandInfo.preview}
                  </code>
                </div>
              ) : null}
              {summaryEntries.length ? (
                summaryEntries.map((entry) => (
                  <div key={entry.key} className="approval-toast-detail">
                    <div className="approval-toast-detail-label">{entry.label}</div>
                    <ToastBody
                      className="approval-toast-detail-value"
                      title={entry.fullValue}
                    >
                      {entry.value}
                    </ToastBody>
                  </div>
                ))
              ) : !commandInfo ? (
                <div className="approval-toast-detail approval-toast-detail-empty">
                  {String(t("approvalToasts.noExtraDetails"))}
                </div>
              ) : null}
            </div>
            <ToastActions className="approval-toast-actions">
              <button
                className="secondary"
                onClick={() => onDecision(request, "decline")}
              >
                {String(t("approvalToasts.decline"))}
              </button>
              {commandInfo && onRemember ? (
                <button
                  className="ghost approval-toast-remember"
                  onClick={() => onRemember(request, commandInfo.tokens)}
                  title={String(
                    t("approvalToasts.allowCommandsStartWith", { preview: commandInfo.preview })
                  )}
                >
                  {String(t("approvalToasts.alwaysAllow"))}
                </button>
              ) : null}
              <button
                className="primary"
                onClick={() => onDecision(request, "accept")}
              >
                {String(t("approvalToasts.approveWithShortcut"))}
              </button>
            </ToastActions>
          </ToastCard>
        );
      })}
    </ToastViewport>
  );
}
