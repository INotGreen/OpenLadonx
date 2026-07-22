import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import { buildConversationItem } from "@utils/threadItems";
import type { CollabAgentRef } from "@/types";
import {
  buildItemForDisplay,
  handleConvertedItemEffects,
} from "./threadItemEventHelpers";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  getInterruptedTurnId: (threadId: string) => string | null;
  pendingInterruptsRef: MutableRefObject<Set<string>>;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  getActiveTurnId: (threadId: string) => string | null;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  hydrateSubagentThreads?: (
    workspaceId: string,
    receivers: CollabAgentRef[],
  ) => void | Promise<void>;
  onReviewExited?: (workspaceId: string, threadId: string) => void;
};

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  getCustomName,
  getInterruptedTurnId,
  pendingInterruptsRef,
  markProcessing,
  markReviewing,
  getActiveTurnId,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  hydrateSubagentThreads,
  onReviewExited,
}: UseThreadItemEventsOptions) {
  const getAgentMessageDisplayId = useCallback(
    (threadId: string, itemId: string, turnId: string | null) => {
      const resolvedTurnId = turnId ?? getActiveTurnId(threadId);
      return resolvedTurnId ? `${resolvedTurnId}:${itemId}` : itemId;
    },
    [getActiveTurnId],
  );

  const shouldIgnoreTurnEvent = useCallback(
    (threadId: string, turnId: string | null) => {
      // 停止请求已发出但真实 turnId 尚未到达（pending interrupt）期间，
      // 一律丢弃该线程的流式事件，收窄「点击停止」与 turn/started 之间的窗口。
      if (pendingInterruptsRef.current.has(threadId)) {
        return true;
      }
      if (!turnId) {
        return false;
      }
      return getInterruptedTurnId(threadId) === turnId;
    },
    [getInterruptedTurnId, pendingInterruptsRef],
  );

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
    ) => {
      const itemTurnId =
        typeof item.turnId === "string"
          ? item.turnId
          : typeof item.turn_id === "string"
            ? item.turn_id
            : null;
      if (shouldIgnoreTurnEvent(threadId, itemTurnId)) {
        return;
      }
      dispatch({ type: "ensureThread", workspaceId, threadId });
      if (shouldMarkProcessing) {
        markProcessing(threadId, true);
      }
      applyCollabThreadLinks(workspaceId, threadId, item);
      const itemType = String(item?.type ?? "");
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
        if (!shouldMarkProcessing) {
          onReviewExited?.(workspaceId, threadId);
        }
      }
      if (itemType === "agentMessage" && shouldMarkProcessing) {
        safeMessageActivity();
        return;
      }
      const itemForDisplay = buildItemForDisplay(item, shouldMarkProcessing);
      const converted = buildConversationItem(itemForDisplay);
      handleConvertedItemEffects({
        converted,
        workspaceId,
        hydrateSubagentThreads,
      });
      if (converted) {
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: converted,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
      }
      safeMessageActivity();
    },
    [
      applyCollabThreadLinks,
      dispatch,
      getCustomName,
      markProcessing,
      markReviewing,
      onReviewExited,
      hydrateSubagentThreads,
      safeMessageActivity,
      shouldIgnoreTurnEvent,
    ],
  );

  const handleToolOutputDelta = useCallback(
    (threadId: string, itemId: string, delta: string) => {
      markProcessing(threadId, true);
      dispatch({ type: "appendToolOutput", threadId, itemId, delta });
      safeMessageActivity();
    },
    [dispatch, markProcessing, safeMessageActivity],
  );

  const handleTerminalInteraction = useCallback(
    (threadId: string, itemId: string, stdin: string) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(threadId, itemId, `\n[stdin]\n${normalized}${suffix}`);
    },
    [handleToolOutputDelta],
  );

  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      turnId,
      delta,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      turnId: string | null;
      delta: string;
    }) => {
      if (shouldIgnoreTurnEvent(threadId, turnId)) {
        return;
      }
      dispatch({ type: "ensureThread", workspaceId, threadId });
      markProcessing(threadId, true);
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      const displayItemId = getAgentMessageDisplayId(threadId, itemId, turnId);
      dispatch({
        type: "appendAgentDelta",
        workspaceId,
        threadId,
        itemId: displayItemId,
        delta,
        hasCustomName,
      });
    },
    [
      dispatch,
      getAgentMessageDisplayId,
      getCustomName,
      markProcessing,
      shouldIgnoreTurnEvent,
    ],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      turnId,
      text,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      turnId: string | null;
      text: string;
    }) => {
      if (shouldIgnoreTurnEvent(threadId, turnId)) {
        return;
      }
      const timestamp = Date.now();
      dispatch({ type: "ensureThread", workspaceId, threadId });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      const displayItemId = getAgentMessageDisplayId(threadId, itemId, turnId);
      dispatch({
        type: "completeAgentMessage",
        workspaceId,
        threadId,
        itemId: displayItemId,
        text,
        hasCustomName,
      });
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp,
      });
      dispatch({
        type: "setLastAgentMessage",
        threadId,
        text,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [
      activeThreadId,
      dispatch,
      getAgentMessageDisplayId,
      getCustomName,
      recordThreadActivity,
      safeMessageActivity,
      shouldIgnoreTurnEvent,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, false);
    },
    [handleItemUpdate],
  );

  const onReasoningSummaryDelta = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      dispatch({ type: "appendReasoningSummary", threadId, itemId, delta });
    },
    [dispatch, shouldIgnoreTurnEvent],
  );

  const onReasoningSummaryBoundary = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      dispatch({ type: "appendReasoningSummaryBoundary", threadId, itemId });
    },
    [dispatch, shouldIgnoreTurnEvent],
  );

  const onReasoningTextDelta = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      dispatch({ type: "appendReasoningContent", threadId, itemId, delta });
    },
    [dispatch, shouldIgnoreTurnEvent],
  );

  const onPlanDelta = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      dispatch({ type: "appendPlanDelta", threadId, itemId, delta });
    },
    [dispatch, shouldIgnoreTurnEvent],
  );

  const onCommandOutputDelta = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta, shouldIgnoreTurnEvent],
  );

  const onTerminalInteraction = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      handleTerminalInteraction(threadId, itemId, stdin);
    },
    [handleTerminalInteraction, shouldIgnoreTurnEvent],
  );

  const onFileChangeOutputDelta = useCallback(
    (
      _workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      if (shouldIgnoreTurnEvent(threadId, turnId ?? null)) {
        return;
      }
      handleToolOutputDelta(threadId, itemId, delta);
    },
    [handleToolOutputDelta, shouldIgnoreTurnEvent],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemCompleted,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onPlanDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
  };
}
