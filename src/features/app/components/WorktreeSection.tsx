import Layers from "lucide-react/dist/esm/icons/layers";
import type { MouseEvent, ReactNode } from "react";

import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { ThreadList } from "./ThreadList";
import { ThreadLoading } from "./ThreadLoading";
import { WorktreeCard } from "./WorktreeCard";
import { getVisibleThreadListState } from "./threadSearchUtils";

type ThreadRowsResult = {
  pinnedRows: Array<{ thread: ThreadSummary; depth: number }>;
  unpinnedRows: Array<{ thread: ThreadSummary; depth: number }>;
  totalRoots: number;
  hasMoreRoots: boolean;
};

type WorktreeSectionProps = {
  worktrees: WorkspaceInfo[];
  deletingWorktreeIds: Set<string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadStatusById: ThreadStatusById;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  pendingUserInputKeys?: Set<string>;
  getThreadRows: (
    threads: ThreadSummary[],
    workspaceId: string,
    getPinTimestamp: (workspaceId: string, threadId: string) => number | null,
    pinVersion?: number,
  ) => ThreadRowsResult;
  getThreadTime: (thread: ThreadSummary) => string | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  pinnedThreadsVersion: number;
  onSelectWorkspace: (id: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
    filePath?: string | null,
  ) => void;
  onShowWorktreeMenu: (event: MouseEvent, worktree: WorkspaceInfo) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  searchQuery?: string;
  isSearchActive?: boolean;
  sectionLabel?: string;
  sectionIcon?: ReactNode;
  className?: string;
};

export function WorktreeSection({
  worktrees,
  deletingWorktreeIds,
  threadsByWorkspace,
  threadStatusById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  activeWorkspaceId,
  activeThreadId,
  pendingUserInputKeys,
  getThreadRows,
  getThreadTime,
  getThreadArgsBadge,
  isThreadPinned,
  getPinTimestamp,
  pinnedThreadsVersion,
  onSelectWorkspace,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onShowThreadMenu,
  onShowWorktreeMenu,
  onLoadOlderThreads,
  searchQuery = "",
  isSearchActive = false,
  sectionLabel = "Worktrees",
  sectionIcon,
  className,
}: WorktreeSectionProps) {
  if (!worktrees.length) {
    return null;
  }

  return (
    <div className={`worktree-section${className ? ` ${className}` : ""}`}>
      <div className="worktree-header">
        <span className="worktree-header-title">
          <span className="worktree-header-icon-wrap">
            {sectionIcon ?? <Layers className="worktree-header-icon" aria-hidden />}
          </span>
          <span>{sectionLabel}</span>
        </span>
        <span className="worktree-header-count">{worktrees.length}</span>
      </div>
      <div className="worktree-list">
        {worktrees.map((worktree) => {
          const worktreeThreads = threadsByWorkspace[worktree.id] ?? [];
          const isLoadingWorktreeThreads =
            threadListLoadingByWorkspace[worktree.id] ?? false;
          const showWorktreeLoader =
            isLoadingWorktreeThreads && worktreeThreads.length === 0;
          const worktreeNextCursor =
            threadListCursorByWorkspace[worktree.id] ?? null;
          const isWorktreePaging =
            threadListPagingByWorkspace[worktree.id] ?? false;
          const {
            unpinnedRows,
            totalRoots: totalWorktreeRoots,
          } = getThreadRows(
            worktreeThreads,
            worktree.id,
            getPinTimestamp,
            pinnedThreadsVersion,
          );
          const {
            visibleRows: filteredWorktreeThreadRows,
            displayRootCount: displayWorktreeRootCount,
          } = getVisibleThreadListState({
            rows: unpinnedRows,
            totalRoots: totalWorktreeRoots,
            workspaceName: worktree.name,
            query: searchQuery,
            isSearchActive,
          });
          const showWorktreeThreadList =
            filteredWorktreeThreadRows.length > 0 || Boolean(worktreeNextCursor);

          return (
            <WorktreeCard
              key={worktree.id}
              worktree={worktree}
              isActive={worktree.id === activeWorkspaceId}
              isDeleting={deletingWorktreeIds.has(worktree.id)}
              onSelectWorkspace={onSelectWorkspace}
              onShowWorktreeMenu={onShowWorktreeMenu}
              onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
            >
              {showWorktreeThreadList && (
                <ThreadList
                  workspaceId={worktree.id}
                  pinnedRows={[]}
                  unpinnedRows={filteredWorktreeThreadRows}
                  totalThreadRoots={displayWorktreeRootCount}
                  nextCursor={worktreeNextCursor}
                  isPaging={isWorktreePaging}
                  nested
                  showLoadOlder={false}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  threadStatusById={threadStatusById}
                  pendingUserInputKeys={pendingUserInputKeys}
                  getThreadTime={getThreadTime}
                  getThreadArgsBadge={getThreadArgsBadge}
                  isThreadPinned={isThreadPinned}
                  onLoadOlderThreads={onLoadOlderThreads}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={onShowThreadMenu}
                />
              )}
              {showWorktreeLoader && <ThreadLoading nested />}
            </WorktreeCard>
          );
        })}
      </div>
    </div>
  );
}
