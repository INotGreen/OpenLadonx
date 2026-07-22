import { memo, useCallback, useDeferredValue, useEffect, useMemo } from "react";
import type { MouseEvent, ReactNode } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import type { ParsedFileLocation } from "../../../utils/fileLinks";
import type { ParsedReasoning } from "../utils/messageRenderUtils";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import { parseReasoning } from "../utils/messageRenderUtils";
import {
  DiffRow,
  countInlineDiffStats,
  ExploreRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  ToolRow,
  UserInputRow,
  WorkingIndicator,
  type DiffStats,
} from "./MessageRows";
import { useMessagesViewState } from "../hooks/useMessagesViewState";

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  isLoadingMessages?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
  workspacePath?: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  codeBlockCopyUseModifier?: boolean;
  showMessageFilePath?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => void;
  onPlanAccept?: () => void;
  onOpenThreadLink?: (threadId: string, workspaceId?: string | null) => void;
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
  onOpenCanvas?: () => void;
  onCollapseSidebar?: () => void;
};

type MessageListItemProps = {
  item: ConversationItem;
  agentFileDiffStatsByPath?: Map<string, DiffStats>;
  isExpanded: boolean;
  parsedReasoning?: ParsedReasoning;
  codeBlockCopyUseModifier?: boolean;
  showMessageFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu: (event: MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink: (threadId: string) => void;
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
  onOpenCanvas?: () => void;
  onRequestAutoScroll?: () => void;
  onToggle: (id: string) => void;
};

function normalizeDiffStatsPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function diffStatsPathKeys(path: string, workspacePath?: string | null) {
  const normalizedPath = normalizeDiffStatsPath(path);
  const keys = new Set<string>([normalizedPath]);
  if (workspacePath && normalizedPath && !normalizedPath.startsWith("/")) {
    keys.add(normalizeDiffStatsPath(`${workspacePath.replace(/\/+$/, "")}/${normalizedPath}`));
  }
  if (workspacePath) {
    const normalizedWorkspace = normalizeDiffStatsPath(workspacePath);
    if (normalizedWorkspace && normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
      keys.add(normalizedPath.slice(normalizedWorkspace.length + 1));
    }
  }
  return keys;
}

function addDiffStats(current: DiffStats | undefined, next: DiffStats): DiffStats {
  return {
    additions: (current?.additions ?? 0) + next.additions,
    deletions: (current?.deletions ?? 0) + next.deletions,
  };
}

function buildAgentFileDiffStatsByMessageId(
  items: ConversationItem[],
  workspacePath?: string | null,
) {
  const result = new Map<string, Map<string, DiffStats>>();
  const currentStatsByPath = new Map<string, DiffStats>();

  for (const item of items) {
    if (item.kind === "tool" && item.toolType === "fileChange") {
      for (const change of item.changes ?? []) {
        if (!change.diff?.trim()) {
          continue;
        }
        const stats = countInlineDiffStats(change.diff);
        if (stats.additions === 0 && stats.deletions === 0) {
          continue;
        }
        for (const key of diffStatsPathKeys(change.path, workspacePath)) {
          currentStatsByPath.set(key, addDiffStats(currentStatsByPath.get(key), stats));
        }
      }
      continue;
    }
    if (item.kind === "message" && item.role === "assistant" && currentStatsByPath.size > 0) {
      result.set(item.id, new Map(currentStatsByPath));
    }
  }

  return result;
}

const MessageListItem = memo(function MessageListItem({
  item,
  agentFileDiffStatsByPath,
  isExpanded,
  parsedReasoning,
  codeBlockCopyUseModifier,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onPreviewFile,
  onOpenCanvas,
  onRequestAutoScroll,
  onToggle,
}: MessageListItemProps) {
  if (item.kind === "message") {
    return (
      <MessageRow
        item={item}
        agentFileDiffStatsByPath={agentFileDiffStatsByPath}
        codeBlockCopyUseModifier={codeBlockCopyUseModifier}
        showMessageFilePath={showMessageFilePath}
        workspacePath={workspacePath}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
        onOpenThreadLink={onOpenThreadLink}
        onPreviewFile={onPreviewFile}
        onOpenCanvas={onOpenCanvas}
      />
    );
  }
  if (item.kind === "reasoning") {
    const parsed = parsedReasoning ?? parseReasoning(item);
    return (
      <ReasoningRow
        item={item}
        parsed={parsed}
        isExpanded={isExpanded}
        onToggle={onToggle}
        showMessageFilePath={showMessageFilePath}
        workspacePath={workspacePath}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
        onOpenThreadLink={onOpenThreadLink}
      />
    );
  }
  if (item.kind === "review") {
    return (
      <ReviewRow
        item={item}
        showMessageFilePath={showMessageFilePath}
        workspacePath={workspacePath}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
        onOpenThreadLink={onOpenThreadLink}
      />
    );
  }
  if (item.kind === "userInput") {
    return (
      <UserInputRow
        item={item}
        isExpanded={isExpanded}
        onToggle={onToggle}
        workspacePath={workspacePath}
      />
    );
  }
  if (item.kind === "diff") {
    return <DiffRow item={item} />;
  }
  if (item.kind === "tool") {
    return (
      <ToolRow
        item={item}
        isExpanded={isExpanded}
        onToggle={onToggle}
        showMessageFilePath={showMessageFilePath}
        workspacePath={workspacePath}
        onOpenFileLink={onOpenFileLink}
        onOpenFileLinkMenu={onOpenFileLinkMenu}
        onOpenThreadLink={onOpenThreadLink}
        onRequestAutoScroll={onRequestAutoScroll}
      />
    );
  }
  if (item.kind === "explore") {
    return <ExploreRow item={item} />;
  }
  return null;
});

export const Messages = memo(function Messages({
  items,
  threadId,
  workspaceId = null,
  isThinking,
  isLoadingMessages = false,
  processingStartedAt = null,
  lastDurationMs = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
  workspacePath = null,
  openTargets,
  selectedOpenAppId,
  codeBlockCopyUseModifier = false,
  showMessageFilePath = true,
  userInputRequests = [],
  onUserInputSubmit,
  onPlanAccept,
  onOpenThreadLink,
  onPreviewFile,
  onOpenCanvas,
  onCollapseSidebar,
}: MessagesProps) {
  const { t } = useI18nSafe();
  const deferredItems = useDeferredValue(items);
  const activeUserInputRequestId =
    threadId && userInputRequests.length
      ? (userInputRequests.find(
          (request) =>
            request.params.thread_id === threadId &&
            (!workspaceId || request.workspace_id === workspaceId),
        )?.request_id ?? null)
      : null;
  const { openFileLink, showFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
    onCollapseSidebar,
  );
  const handleOpenThreadLink = useCallback(
    (threadId: string) => {
      onOpenThreadLink?.(threadId, workspaceId ?? null);
    },
    [onOpenThreadLink, workspaceId],
  );
  const hasActiveUserInputRequest = activeUserInputRequestId !== null;
  const hasVisibleUserInputRequest = hasActiveUserInputRequest && Boolean(onUserInputSubmit);
  const userInputNode =
    hasActiveUserInputRequest && onUserInputSubmit ? (
      <RequestUserInputMessage
        requests={userInputRequests}
        activeThreadId={threadId}
        activeWorkspaceId={workspaceId}
        onSubmit={onUserInputSubmit}
      />
    ) : null;
  const {
    bottomRef,
    containerRef,
    updateAutoScroll,
    requestAutoScroll,
    expandedItems,
    toggleExpanded,
    collapsedToolGroups,
    toggleToolGroup,
    reasoningMetaById,
    latestReasoningLabel,
    groupedItems,
    virtualizer,
    tailIndex,
    planFollowup,
    dismissPlanFollowup,
  } = useMessagesViewState({
    items: deferredItems,
    threadId,
    isThinking,
    activeUserInputRequestId,
    hasVisibleUserInputRequest,
    onPlanAccept,
  });
  const agentFileDiffStatsByMessageId = useMemo(
    () => buildAgentFileDiffStatsByMessageId(deferredItems, workspacePath),
    [deferredItems, workspacePath],
  );
  useEffect(() => {
    if (!planFollowup.shouldShow || !planFollowup.planItemId || !onPlanAccept) {
      return;
    }
    dismissPlanFollowup();
    onPlanAccept();
  }, [planFollowup.shouldShow, planFollowup.planItemId, onPlanAccept, dismissPlanFollowup]);

  const renderItemForEntry = (item: ConversationItem) => (
    <MessageListItem
      key={item.id}
      item={item}
      agentFileDiffStatsByPath={
        item.kind === "message" ? agentFileDiffStatsByMessageId.get(item.id) : undefined
      }
      isExpanded={expandedItems.has(item.id)}
      parsedReasoning={
        item.kind === "reasoning" ? reasoningMetaById.get(item.id) : undefined
      }
      codeBlockCopyUseModifier={codeBlockCopyUseModifier}
      showMessageFilePath={showMessageFilePath}
      workspacePath={workspacePath}
      onOpenFileLink={openFileLink}
      onOpenFileLinkMenu={showFileLinkMenu}
      onOpenThreadLink={handleOpenThreadLink}
      onPreviewFile={onPreviewFile}
      onOpenCanvas={onOpenCanvas}
      onRequestAutoScroll={requestAutoScroll}
      onToggle={toggleExpanded}
    />
  );

  const renderTail = () => (
    <>
      {userInputNode}
      <div className="messages-working-indicator">
        <WorkingIndicator
          isThinking={isThinking}
          processingStartedAt={processingStartedAt}
          lastDurationMs={lastDurationMs}
          hasItems={deferredItems.length > 0}
          reasoningLabel={latestReasoningLabel}
          showPollingFetchStatus={showPollingFetchStatus}
          pollingIntervalMs={pollingIntervalMs}
        />
      </div>
      {!deferredItems.length && !userInputNode && !isThinking && isLoadingMessages && (
        <div className="empty messages-empty">
          <div className="messages-loading-indicator" role="status" aria-live="polite">
            <span className="working-spinner" aria-hidden />
            <span className="messages-loading-label">{String(t("common.loading"))}</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </>
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      className="messages messages-full"
      ref={containerRef}
      onScroll={updateAutoScroll}
    >
      <div className="messages-inner" style={{ position: "relative" }}>
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualItems.map((vi) => {
            const isTail = vi.index === tailIndex;
            const entry = isTail ? null : groupedItems[vi.index];
            let content: ReactNode;
            if (isTail) {
              content = renderTail();
            } else if (entry?.kind === "toolGroup") {
              const { group } = entry;
              const isCollapsed = !collapsedToolGroups.has(`expanded:${group.id}`);
              const summaryParts = [
                String(t("messages.codex.toolCallCount", { count: group.toolCount })),
              ];
              if (group.messageCount > 0) {
                summaryParts.push(
                  String(t("messages.codex.messageCount", { count: group.messageCount })),
                );
              }
              const summaryText = summaryParts.join(", ");
              const groupBodyId = `tool-group-${group.id}`;
              const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;
              content = (
                <div className={`tool-group ${isCollapsed ? "tool-group-collapsed" : ""}`}>
                  <div className="tool-group-header">
                    <button
                      type="button"
                      className="tool-group-toggle"
                      onClick={() => toggleToolGroup(group.id, true)}
                      aria-expanded={!isCollapsed}
                      aria-controls={groupBodyId}
                      aria-label={String(
                        t(
                          isCollapsed
                            ? "messages.codex.expandToolCalls"
                            : "messages.codex.collapseToolCalls",
                        ),
                      )}
                    >
                      <span className="tool-group-chevron" aria-hidden>
                        <ChevronIcon size={14} />
                      </span>
                      <Wrench className="tool-inline-icon" size={16} aria-hidden />
                      <span className="tool-group-summary">{summaryText}</span>
                    </button>
                  </div>
                  {!isCollapsed && (
                    <div className="tool-group-body" id={groupBodyId}>
                      {group.items.map(renderItemForEntry)}
                    </div>
                  )}
                </div>
              );
            } else if (entry?.kind === "item") {
              content = renderItemForEntry(entry.item);
            } else {
              content = null;
            }
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  paddingBottom: isTail ? 0 : 6,
                }}
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
