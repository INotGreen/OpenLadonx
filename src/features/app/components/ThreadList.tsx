import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";

import type { ThreadSummary } from "../../../types";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { ThreadRow } from "./ThreadRow";
import { buildThreadRowVisibility } from "./threadRowVisibility";

type ThreadListRow = {
  thread: ThreadSummary;
  depth: number;
};

type ThreadListProps = {
  workspaceId: string;
  pinnedRows: ThreadListRow[];
  unpinnedRows: ThreadListRow[];
  totalThreadRoots: number;
  nextCursor: string | null;
  isPaging: boolean;
  hasMoreLocalRows?: boolean;
  loadOlderLabel?: string;
  nested?: boolean;
  showLoadOlder?: boolean;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  pendingUserInputKeys?: Set<string>;
  getThreadTime: (thread: ThreadSummary) => string | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onLoadOlderThreads: (workspaceId: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
    filePath?: string | null,
  ) => void;
};

export function ThreadList({
  workspaceId,
  pinnedRows,
  unpinnedRows,
  totalThreadRoots,
  nextCursor,
  isPaging,
  hasMoreLocalRows = false,
  loadOlderLabel,
  nested,
  showLoadOlder = true,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  pendingUserInputKeys,
  getThreadTime,
  getThreadArgsBadge,
  isThreadPinned,
  onLoadOlderThreads,
  onSelectThread,
  onShowThreadMenu,
}: ThreadListProps) {
  const { t } = useI18nSafe();
  const indentUnit = nested ? 10 : 14;
  const [collapsedThreadKeys, setCollapsedThreadKeys] = useState<Set<string>>(new Set());
  const [olderCollapsedByWs, setOlderCollapsedByWs] = useState<Set<string>>(new Set());
  const baselineIdsByWsRef = useRef<Map<string, Set<string>>>(new Map());

  const handleToggleThreadSubagents = useCallback(
    (_: string, threadId: string) => {
      const threadKey = `${workspaceId}:${threadId}`;
      setCollapsedThreadKeys((prev) => {
        const next = new Set(prev);
        if (next.has(threadKey)) {
          next.delete(threadKey);
        } else {
          next.add(threadKey);
        }
        return next;
      });
    },
    [workspaceId],
  );

  const baselineIds = baselineIdsByWsRef.current.get(workspaceId);
  const olderRows = baselineIds
    ? unpinnedRows.filter((row) => !baselineIds.has(row.thread.id))
    : [];
  const hiddenOlderCount = olderRows.length;
  const hasOlderLoaded = hiddenOlderCount > 0;
  const isOlderCollapsed = olderCollapsedByWs.has(workspaceId);

  const renderedUnpinnedRows =
    isOlderCollapsed && baselineIds
      ? unpinnedRows.filter((row) => baselineIds.has(row.thread.id))
      : unpinnedRows;

  const toggleOlderCollapsed = useCallback(
    (wsId: string) => {
      setOlderCollapsedByWs((prev) => {
        const next = new Set(prev);
        if (next.has(wsId)) {
          next.delete(wsId);
        } else {
          next.add(wsId);
        }
        return next;
      });
    },
    [],
  );

  const handleLoadOlder = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      const map = baselineIdsByWsRef.current;
      if (!map.has(workspaceId)) {
        map.set(workspaceId, new Set(unpinnedRows.map((row) => row.thread.id)));
      }
      onLoadOlderThreads(workspaceId);
    },
    [onLoadOlderThreads, unpinnedRows, workspaceId],
  );

  const pinnedVisibility = useMemo(
    () =>
      buildThreadRowVisibility(
        pinnedRows,
        (row) => collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`),
      ),
    [collapsedThreadKeys, pinnedRows, workspaceId],
  );
  const unpinnedVisibility = useMemo(
    () =>
      buildThreadRowVisibility(
        renderedUnpinnedRows,
        (row) => collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`),
      ),
    [collapsedThreadKeys, renderedUnpinnedRows, workspaceId],
  );

  return (
    <div className={`thread-list${nested ? " thread-list-nested" : ""}`}>
      {pinnedVisibility.visibleRows.map((row, index) => (
        <ThreadRow
          key={row.thread.id}
          thread={row.thread}
          className={`${index === 0 ? "is-first-tree-item" : ""}${
            index === pinnedVisibility.visibleRows.length - 1 &&
            unpinnedVisibility.visibleRows.length === 0
              ? " is-last-tree-item"
              : ""
          }`}
          depth={row.depth}
          workspaceId={workspaceId}
          indentUnit={indentUnit}
          activeWorkspaceId={activeWorkspaceId}
          activeThreadId={activeThreadId}
          threadStatusById={threadStatusById}
          pendingUserInputKeys={pendingUserInputKeys}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
          hasSubagentChildren={pinnedVisibility.rowsWithChildren.has(row)}
          subagentsExpanded={!collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`)}
          onToggleSubagents={handleToggleThreadSubagents}
        />
      ))}
      {pinnedVisibility.visibleRows.length > 0 && unpinnedVisibility.visibleRows.length > 0 && (
        <div className="thread-list-separator" aria-hidden="true" />
      )}
      {unpinnedVisibility.visibleRows.map((row, index) => (
        <ThreadRow
          key={row.thread.id}
          thread={row.thread}
          className={`${pinnedVisibility.visibleRows.length === 0 && index === 0 ? "is-first-tree-item" : ""}${
            index === unpinnedVisibility.visibleRows.length - 1
              ? " is-last-tree-item"
              : ""
          }`}
          depth={row.depth}
          workspaceId={workspaceId}
          indentUnit={indentUnit}
          activeWorkspaceId={activeWorkspaceId}
          activeThreadId={activeThreadId}
          threadStatusById={threadStatusById}
          pendingUserInputKeys={pendingUserInputKeys}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
          hasSubagentChildren={unpinnedVisibility.rowsWithChildren.has(row)}
          subagentsExpanded={!collapsedThreadKeys.has(`${workspaceId}:${row.thread.id}`)}
          onToggleSubagents={handleToggleThreadSubagents}
        />
      ))}
      {showLoadOlder &&
        ((!isOlderCollapsed && (nextCursor || hasMoreLocalRows)) || hasOlderLoaded) && (
          <div className="thread-more-row">
            {!isOlderCollapsed && (nextCursor || hasMoreLocalRows) && (
              <button
                className="thread-more"
                onClick={handleLoadOlder}
                disabled={isPaging}
              >
                {isPaging
                  ? String(t("thread.loadOlder.loading"))
                  : loadOlderLabel
                    ? loadOlderLabel
                    : totalThreadRoots === 0
                    ? String(t("thread.loadOlder.searchOlder"))
                    : String(t("thread.loadOlder.loadOlder"))}
              </button>
            )}
            {hasOlderLoaded && (
              <button
                className="thread-more"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleOlderCollapsed(workspaceId);
                }}
              >
                {isOlderCollapsed
                  ? String(t("thread.loadOlder.expand", { count: hiddenOlderCount }))
                  : String(t("thread.loadOlder.collapse"))}
              </button>
            )}
          </div>
        )}
    </div>
  );
}
