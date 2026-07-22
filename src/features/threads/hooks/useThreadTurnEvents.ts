import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { RateLimitSnapshot, TurnPlan } from "@/types";
import { interruptTurn as interruptTurnService } from "@services/tauri";
import { getThreadTimestamp } from "@utils/threadItems";
import {
  asString,
  mergeTurnPlans,
  normalizeThreadGoal,
  normalizePlanUpdate,
  normalizeRateLimits,
  normalizeTokenUsage,
} from "@threads/utils/threadNormalize";
import {
  getLiveThreadSubagentSummaryPatch,
  getThreadStartAction,
  normalizeThreadStatusType,
  resetThreadTurnState,
  shouldIgnoreOrphanSubagentThread,
} from "./threadTurnEventHelpers";
import type { ThreadAction } from "./useThreadsReducer";

type UseThreadTurnEventsOptions = {
  dispatch: Dispatch<ThreadAction>;
  planByThreadRef: MutableRefObject<Record<string, TurnPlan | null>>;
  getCurrentRateLimits?: (workspaceId: string) => RateLimitSnapshot | null;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  isThreadHidden: (workspaceId: string, threadId: string) => boolean;
  setThreadLoaded: (threadId: string, isLoaded: boolean) => void;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  setInterruptedTurnId: (threadId: string, turnId: string | null) => void;
  getActiveTurnId: (threadId: string) => string | null;
  getInterruptedTurnId: (threadId: string) => string | null;
  pendingInterruptsRef: MutableRefObject<Set<string>>;
  pushThreadErrorMessage: (threadId: string, message: string) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (workspaceId: string, threadId: string, timestamp?: number) => void;
  hydrateThreadOnTurnCompleted?: (workspaceId: string, threadId: string) => void | Promise<void>;
};

export function useThreadTurnEvents({
  dispatch,
  planByThreadRef,
  getCurrentRateLimits,
  getCustomName,
  isThreadHidden,
  setThreadLoaded,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  setInterruptedTurnId,
  getActiveTurnId,
  getInterruptedTurnId,
  pendingInterruptsRef,
  pushThreadErrorMessage,
  safeMessageActivity,
  recordThreadActivity,
  hydrateThreadOnTurnCompleted,
}: UseThreadTurnEventsOptions) {
  const immediateActiveTurnIdByThreadRef = useRef<Record<string, string | null>>({});
  const lastReducerActiveTurnIdByThreadRef = useRef<Record<string, string | null>>({});
  const hasOptimisticActiveTurnByThreadRef = useRef<Record<string, boolean>>({});

  const getLatestKnownActiveTurnId = useCallback(
    (threadId: string) => {
      const reducerTurnId = getActiveTurnId(threadId);
      const lastReducerTurnId = lastReducerActiveTurnIdByThreadRef.current[threadId];
      const immediateTurnId = immediateActiveTurnIdByThreadRef.current[threadId];
      const hasOptimisticTurn =
        hasOptimisticActiveTurnByThreadRef.current[threadId] === true;

      if (hasOptimisticTurn && immediateTurnId !== undefined) {
        if (reducerTurnId === immediateTurnId) {
          // Reducer caught up with our optimistic write.
          hasOptimisticActiveTurnByThreadRef.current[threadId] = false;
        } else if (
          lastReducerTurnId !== undefined &&
          reducerTurnId !== lastReducerTurnId
        ) {
          // Reducer changed independently (e.g. resume hydration), so adopt it.
          hasOptimisticActiveTurnByThreadRef.current[threadId] = false;
          immediateActiveTurnIdByThreadRef.current[threadId] = reducerTurnId;
        } else {
          lastReducerActiveTurnIdByThreadRef.current[threadId] = reducerTurnId;
          return immediateTurnId;
        }
      }

      if (lastReducerTurnId !== reducerTurnId) {
        // Keep cache aligned with reducer when we are not in an optimistic window.
        lastReducerActiveTurnIdByThreadRef.current[threadId] = reducerTurnId;
        immediateActiveTurnIdByThreadRef.current[threadId] = reducerTurnId;
      }

      if (immediateTurnId !== undefined) {
        return immediateActiveTurnIdByThreadRef.current[threadId];
      }
      return reducerTurnId;
    },
    [getActiveTurnId],
  );

  const onThreadStarted = useCallback(
    (workspaceId: string, thread: Record<string, unknown>) => {
      const threadId = asString(thread.id);
      if (!threadId) {
        return;
      }
      const threadStartAction = getThreadStartAction(
        workspaceId,
        threadId,
        thread,
        isThreadHidden,
      );
      if (threadStartAction === "skip") {
        return;
      }
      if (threadStartAction === "hide") {
        dispatch({ type: "hideThread", workspaceId, threadId });
        return;
      }
      if (shouldIgnoreOrphanSubagentThread(thread)) {
        return;
      }
      const subagentSummaryPatch = getLiveThreadSubagentSummaryPatch(thread);
      dispatch({ type: "ensureThread", workspaceId, threadId });
      if (subagentSummaryPatch) {
        dispatch({
          type: "mergeThreadSummary",
          workspaceId,
          threadId,
          patch: subagentSummaryPatch,
        });
      }
      const timestamp = getThreadTimestamp(thread);
      const activityTimestamp = timestamp > 0 ? timestamp : Date.now();
      recordThreadActivity(workspaceId, threadId, activityTimestamp);
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp: activityTimestamp,
      });

      safeMessageActivity();
    },
    [dispatch, isThreadHidden, recordThreadActivity, safeMessageActivity],
  );

  const onThreadNameUpdated = useCallback(
    (
      _workspaceId: string,
      payload: { threadId: string; threadName: string | null },
    ) => {
      void payload;
    },
    [],
  );

  const onThreadArchived = useCallback(
    (workspaceId: string, threadId: string) => {
      if (!threadId) {
        return;
      }
      dispatch({ type: "removeThread", workspaceId, threadId });
    },
    [dispatch],
  );

  const onThreadUnarchived = useCallback(
    (workspaceId: string, threadId: string) => {
      if (!threadId) {
        return;
      }
      dispatch({ type: "ensureThread", workspaceId, threadId });
      const customName = getCustomName(workspaceId, threadId);
      if (customName) {
        dispatch({
          type: "setThreadName",
          workspaceId,
          threadId,
          name: customName,
        });
      }
      const timestamp = Date.now();
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
    },
    [dispatch, getCustomName, recordThreadActivity, safeMessageActivity],
  );

  const onTurnStarted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId,
      });
      if (pendingInterruptsRef.current.has(threadId)) {
        pendingInterruptsRef.current.delete(threadId);
        if (turnId) {
          // 记录被中断的 turnId，使后端确认中断前到达的流式消息/事件被抑制。
          // 否则停止后回复仍会渲染出来，表现为「过一会儿继续自动对话」。
          setInterruptedTurnId(threadId, turnId);
          void interruptTurnService(workspaceId, threadId, turnId).catch(() => {});
        }
        return;
      }
      setInterruptedTurnId(threadId, null);
      markProcessing(threadId, true);
      if (turnId) {
        lastReducerActiveTurnIdByThreadRef.current[threadId] =
          getActiveTurnId(threadId);
        hasOptimisticActiveTurnByThreadRef.current[threadId] = true;
        immediateActiveTurnIdByThreadRef.current[threadId] = turnId;
        setActiveTurnId(threadId, turnId);
      }
    },
    [
      dispatch,
      getActiveTurnId,
      markProcessing,
      pendingInterruptsRef,
      setActiveTurnId,
      setInterruptedTurnId,
    ],
  );

  const onTurnCompleted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const activeTurnId = getLatestKnownActiveTurnId(threadId);
      if (turnId && activeTurnId && turnId !== activeTurnId) {
        return;
      }
      // 若该 turn 是用户主动中断的，跳过完成后的全量 hydration。
      // 否则会把后端（可能仍在生成 / 已完成）的回复以合并方式拉回，
      // 绕过 shouldIgnoreTurnEvent，表现为「停止后又冒出回复」。
      const wasInterrupted =
        (turnId ? getInterruptedTurnId(threadId) === turnId : false) ||
        pendingInterruptsRef.current.has(threadId);
      markProcessing(threadId, false);
      resetThreadTurnState(
        {
          hasOptimisticActiveTurnByThreadRef,
          immediateActiveTurnIdByThreadRef,
          pendingInterruptsRef,
        },
        threadId,
      );
      setInterruptedTurnId(threadId, null);
      setActiveTurnId(threadId, null);
      if (workspaceId && !wasInterrupted) {
        void hydrateThreadOnTurnCompleted?.(workspaceId, threadId);
      }
    },
    [
      dispatch,
      getInterruptedTurnId,
      getLatestKnownActiveTurnId,
      hydrateThreadOnTurnCompleted,
      markProcessing,
      pendingInterruptsRef,
      setActiveTurnId,
      setInterruptedTurnId,
    ],
  );

  const onThreadStatusChanged = useCallback(
    (_workspaceId: string, threadId: string, status: Record<string, unknown>) => {
      const statusType = normalizeThreadStatusType(status);
      if (!statusType) {
        return;
      }
      if (statusType === "active") {
        markProcessing(threadId, true);
        return;
      }
      if (
        statusType === "idle" ||
        statusType === "notloaded" ||
        statusType === "systemerror"
      ) {
        markProcessing(threadId, false);
        if (statusType === "notloaded") {
          setThreadLoaded(threadId, false);
          markReviewing(threadId, false);
        }
        resetThreadTurnState(
          {
            hasOptimisticActiveTurnByThreadRef,
            immediateActiveTurnIdByThreadRef,
            pendingInterruptsRef,
          },
          threadId,
        );
        setInterruptedTurnId(threadId, null);
        setActiveTurnId(threadId, null);
      }
    },
    [
      markProcessing,
      markReviewing,
      pendingInterruptsRef,
      setActiveTurnId,
      setThreadLoaded,
      setInterruptedTurnId,
    ],
  );

  const onThreadClosed = useCallback(
    (_workspaceId: string, threadId: string) => {
      setThreadLoaded(threadId, false);
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      resetThreadTurnState(
        {
          hasOptimisticActiveTurnByThreadRef,
          immediateActiveTurnIdByThreadRef,
          pendingInterruptsRef,
        },
        threadId,
      );
      setInterruptedTurnId(threadId, null);
      setActiveTurnId(threadId, null);
    },
    [
      markProcessing,
      markReviewing,
      pendingInterruptsRef,
      setActiveTurnId,
      setThreadLoaded,
    ],
  );

  const onTurnPlanUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: { explanation: unknown; plan: unknown },
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      const normalized = normalizePlanUpdate(
        turnId,
        payload.explanation,
        payload.plan,
      );
      const merged = mergeTurnPlans(planByThreadRef.current[threadId] ?? null, normalized);
      dispatch({ type: "setThreadPlan", threadId, plan: merged });
    },
    [dispatch, planByThreadRef],
  );

  const onTurnDiffUpdated = useCallback(
    (workspaceId: string, threadId: string, diff: string) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      dispatch({ type: "setThreadTurnDiff", threadId, diff });
    },
    [dispatch],
  );

  const onThreadTokenUsageUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      tokenUsage: Record<string, unknown> | null,
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      dispatch({
        type: "setThreadTokenUsage",
        threadId,
        tokenUsage: normalizeTokenUsage(tokenUsage),
      });
    },
    [dispatch],
  );

  const onThreadGoalUpdated = useCallback(
    (workspaceId: string, threadId: string, goal: Record<string, unknown> | null) => {
      dispatch({ type: "ensureThread", workspaceId, threadId });
      dispatch({ type: "setThreadGoal", threadId, goal: normalizeThreadGoal(threadId, goal) });
    },
    [dispatch],
  );

  const onAccountRateLimitsUpdated = useCallback(
    (workspaceId: string, rateLimits: Record<string, unknown>) => {
      const previousRateLimits = getCurrentRateLimits?.(workspaceId) ?? null;
      dispatch({
        type: "setRateLimits",
        workspaceId,
        rateLimits: normalizeRateLimits(rateLimits, previousRateLimits),
      });
    },
    [dispatch, getCurrentRateLimits],
  );

  const onTurnError = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: { message: string; willRetry: boolean },
    ) => {
      if (payload.willRetry) {
        return;
      }
      const activeTurnId = getLatestKnownActiveTurnId(threadId);
      if (turnId && activeTurnId && turnId !== activeTurnId) {
        return;
      }
      dispatch({ type: "ensureThread", workspaceId, threadId });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      resetThreadTurnState(
        {
          hasOptimisticActiveTurnByThreadRef,
          immediateActiveTurnIdByThreadRef,
          pendingInterruptsRef,
        },
        threadId,
      );
      setActiveTurnId(threadId, null);
      const message = payload.message
        ? `Turn failed: ${payload.message}`
        : "Turn failed.";
      pushThreadErrorMessage(threadId, message);
      safeMessageActivity();
    },
    [
      dispatch,
      getLatestKnownActiveTurnId,
      markProcessing,
      markReviewing,
      pushThreadErrorMessage,
      safeMessageActivity,
      setActiveTurnId,
      setInterruptedTurnId,
    ],
  );

  return {
    onThreadStarted,
    onThreadNameUpdated,
    onThreadArchived,
    onThreadUnarchived,
    onTurnStarted,
    onTurnCompleted,
    onThreadStatusChanged,
    onThreadClosed,
    onTurnPlanUpdated,
    onTurnDiffUpdated,
    onThreadTokenUsageUpdated,
    onThreadGoalUpdated,
    onAccountRateLimitsUpdated,
    onTurnError,
  };
}
