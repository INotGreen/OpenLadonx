import { useEffect, useMemo, useState } from "react";
import type { Dispatch, MouseEvent, SetStateAction } from "react";
import Copy from "lucide-react/dist/esm/icons/copy";
import { useI18nSafe } from "@/hooks/useI18nSafe";

import type { ThreadSummary, WorkspaceInfo, WorkspaceSurface } from "../../../types";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { ThreadList } from "./ThreadList";
import { ThreadLoading } from "./ThreadLoading";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { WorktreeSection } from "./WorktreeSection";
import { getVisibleThreadListState, splitRowsByRoot } from "./threadSearchUtils";
import type { ThreadRowsResult, WorkspaceGroupSection } from "./sidebarTypes";

type SidebarWorkspaceGroupsProps = {
  groups: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  collapsedGroups: Set<string>;
  ungroupedCollapseId: string;
  toggleGroupCollapse: (groupId: string) => void;
  cloneChildIds: Set<string>;
  clonesBySource: Map<string, WorkspaceInfo[]>;
  worktreesByParent: Map<string, WorkspaceInfo[]>;
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
  newAgentDraftWorkspaceId?: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
    filePath?: string | null,
  ) => void;
  onShowWorkspaceMenu: (event: MouseEvent, workspaceId: string) => void;
  onShowWorktreeMenu: (event: MouseEvent, worktree: WorkspaceInfo) => void;
  onShowCloneMenu: (event: MouseEvent, worktree: WorkspaceInfo) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
};

type SidebarWorkspaceEntryProps = Omit<
  SidebarWorkspaceGroupsProps,
  | "groups"
  | "hasWorkspaceGroups"
  | "collapsedGroups"
  | "ungroupedCollapseId"
  | "toggleGroupCollapse"
> & {
  surface: WorkspaceSurface;
  workspace: WorkspaceInfo;
  isCollapsedOverride?: boolean;
  onToggleWorkspaceCollapseOverride?: (collapsed: boolean) => void;
};

function belongsToSurface(
  workspace: WorkspaceInfo,
  surface: WorkspaceSurface,
) {
  return workspace.source === surface;
}

function SidebarWorkspaceEntry({
  surface,
  workspace,
  cloneChildIds,
  clonesBySource,
  worktreesByParent,
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
  newAgentDraftWorkspaceId,
  onSelectWorkspace,
  onAddAgent,
  isCollapsedOverride,
  onToggleWorkspaceCollapseOverride,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onShowThreadMenu,
  onShowWorkspaceMenu,
  onShowWorktreeMenu,
  onShowCloneMenu,
  onLoadOlderThreads,
}: SidebarWorkspaceEntryProps) {
  const { t } = useI18nSafe();
  const INITIAL_VISIBLE_THREAD_ROOTS = 5;

  const threads = threadsByWorkspace[workspace.id] ?? [];
  const isCollapsed = isCollapsedOverride ?? workspace.settings.sidebarCollapsed;
  const {
    unpinnedRows,
    totalRoots: totalThreadRoots,
  } = getThreadRows(threads, workspace.id, getPinTimestamp, pinnedThreadsVersion);
  const nextCursor = threadListCursorByWorkspace[workspace.id] ?? null;
  const {
    visibleRows: filteredThreadRows,
    displayRootCount: displayThreadRootCount,
  } = getVisibleThreadListState({
    rows: unpinnedRows,
    totalRoots: totalThreadRoots,
    workspaceName: workspace.name,
    query: "",
    isSearchActive: false,
  });
  const showThreadList = filteredThreadRows.length > 0 || Boolean(nextCursor);
  const isLoadingThreads = threadListLoadingByWorkspace[workspace.id] ?? false;
  const showThreadLoader = isLoadingThreads && threads.length === 0;
  const isPaging = threadListPagingByWorkspace[workspace.id] ?? false;
  const clones = clonesBySource.get(workspace.id) ?? [];
  const visibleClones = surface === "codex" ? clones : [];
  const worktrees = surface === "codex" ? (worktreesByParent.get(workspace.id) ?? []) : [];
  const isDraftNewAgent = newAgentDraftWorkspaceId === workspace.id;
  const isDraftRowActive = isDraftNewAgent && workspace.id === activeWorkspaceId && !activeThreadId;
  const [visibleThreadRootCount, setVisibleThreadRootCount] = useState(INITIAL_VISIBLE_THREAD_ROOTS);

  const visibleThreadRows = useMemo(() => {
    const rootGroups = splitRowsByRoot(filteredThreadRows);
    return rootGroups.slice(0, visibleThreadRootCount).flatMap((group) => group.rows);
  }, [filteredThreadRows, visibleThreadRootCount]);
  const hiddenThreadRootCount = Math.max(
    0,
    displayThreadRootCount - Math.min(displayThreadRootCount, visibleThreadRootCount),
  );
  const hasMoreVisibleThreadRoots = hiddenThreadRootCount > 0;

  useEffect(() => {
    setVisibleThreadRootCount(INITIAL_VISIBLE_THREAD_ROOTS);
  }, [workspace.id, surface]);

  if (cloneChildIds.has(workspace.id)) {
    return null;
  }

  return (
    <WorkspaceCard
      workspace={workspace}
      surface={surface}
      workspaceName={workspace.name}
      isActive={workspace.id === activeWorkspaceId}
      isCollapsed={isCollapsed}
      onSelectWorkspace={onSelectWorkspace}
      onShowWorkspaceMenu={onShowWorkspaceMenu}
      onToggleWorkspaceCollapse={(workspaceId, collapsed) => {
        if (onToggleWorkspaceCollapseOverride) {
          onToggleWorkspaceCollapseOverride(collapsed);
          return;
        }
        onToggleWorkspaceCollapse(workspaceId, collapsed);
      }}
      onAddAgent={onAddAgent}
    >
      {surface === "codex" && isDraftNewAgent && (
        <div
          className={`thread-row thread-row-draft${isDraftRowActive ? " active" : ""}`}
          onClick={() => onSelectWorkspace(workspace.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectWorkspace(workspace.id);
            }
          }}
        >
          <div className="thread-content">
            <div className="thread-headline">
              <span className="thread-name">New Agent</span>
            </div>
          </div>
        </div>
      )}
      {visibleClones.length > 0 && (
        <WorktreeSection
          worktrees={visibleClones}
          deletingWorktreeIds={deletingWorktreeIds}
          threadsByWorkspace={threadsByWorkspace}
          threadStatusById={threadStatusById}
          threadListLoadingByWorkspace={threadListLoadingByWorkspace}
          threadListPagingByWorkspace={threadListPagingByWorkspace}
          threadListCursorByWorkspace={threadListCursorByWorkspace}
          activeWorkspaceId={activeWorkspaceId}
          activeThreadId={activeThreadId}
          pendingUserInputKeys={pendingUserInputKeys}
          getThreadRows={getThreadRows}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          getPinTimestamp={getPinTimestamp}
          pinnedThreadsVersion={pinnedThreadsVersion}
          onSelectWorkspace={onSelectWorkspace}
          onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
          onShowWorktreeMenu={onShowCloneMenu}
          onLoadOlderThreads={onLoadOlderThreads}
          sectionLabel={String(t("sidebar.cloneAgents"))}
          sectionIcon={<Copy className="worktree-header-icon" aria-hidden />}
          className="clone-section"
        />
      )}
      {worktrees.length > 0 && (
        <WorktreeSection
          worktrees={worktrees}
          deletingWorktreeIds={deletingWorktreeIds}
          threadsByWorkspace={threadsByWorkspace}
          threadStatusById={threadStatusById}
          threadListLoadingByWorkspace={threadListLoadingByWorkspace}
          threadListPagingByWorkspace={threadListPagingByWorkspace}
          threadListCursorByWorkspace={threadListCursorByWorkspace}
          activeWorkspaceId={activeWorkspaceId}
          activeThreadId={activeThreadId}
          pendingUserInputKeys={pendingUserInputKeys}
          getThreadRows={getThreadRows}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          getPinTimestamp={getPinTimestamp}
          pinnedThreadsVersion={pinnedThreadsVersion}
          onSelectWorkspace={onSelectWorkspace}
          onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
          onShowWorktreeMenu={onShowWorktreeMenu}
          onLoadOlderThreads={onLoadOlderThreads}
        />
      )}
      {showThreadList && (
        <ThreadList
          workspaceId={workspace.id}
          pinnedRows={[]}
          unpinnedRows={visibleThreadRows}
          totalThreadRoots={displayThreadRootCount}
          hasMoreLocalRows={hasMoreVisibleThreadRoots}
          nextCursor={hasMoreVisibleThreadRoots ? null : nextCursor}
          isPaging={isPaging}
          activeWorkspaceId={activeWorkspaceId}
          activeThreadId={activeThreadId}
          threadStatusById={threadStatusById}
          pendingUserInputKeys={pendingUserInputKeys}
          getThreadTime={getThreadTime}
          getThreadArgsBadge={getThreadArgsBadge}
          isThreadPinned={isThreadPinned}
          onLoadOlderThreads={(workspaceId) => {
            if (hasMoreVisibleThreadRoots) {
              setVisibleThreadRootCount((current) => current + INITIAL_VISIBLE_THREAD_ROOTS);
              return;
            }
            onLoadOlderThreads(workspaceId);
          }}
          onSelectThread={onSelectThread}
          onShowThreadMenu={onShowThreadMenu}
        />
      )}
      {showThreadLoader && <ThreadLoading />}
    </WorkspaceCard>
  );
}

function renderWorkspaceSections({
  groups,
  hasWorkspaceGroups,
  collapsedGroups,
  ungroupedCollapseId,
  toggleGroupCollapse,
  surface,
  t,
  duplicateWorkspaceIds,
  surfaceCollapsedByKey,
  setSurfaceCollapsedByKey,
  entryProps,
}: {
  groups: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  collapsedGroups: Set<string>;
  ungroupedCollapseId: string;
  toggleGroupCollapse: (groupId: string) => void;
  surface: WorkspaceSurface;
  t: ReturnType<typeof useI18nSafe>["t"];
  duplicateWorkspaceIds: Set<string>;
  surfaceCollapsedByKey: Record<string, boolean>;
  setSurfaceCollapsedByKey: Dispatch<SetStateAction<Record<string, boolean>>>;
  entryProps: Omit<
    SidebarWorkspaceGroupsProps,
    | "groups"
    | "hasWorkspaceGroups"
    | "collapsedGroups"
    | "ungroupedCollapseId"
    | "toggleGroupCollapse"
  >;
}) {
  return groups.map((group) => {
    const showGroupHeader = Boolean(group.id) || hasWorkspaceGroups || groups.length > 0;
    const toggleId = group.id
      ? `${surface}:${group.id}`
      : (showGroupHeader ? `${surface}:${ungroupedCollapseId}` : null);
    const isGroupCollapsed = Boolean(toggleId && collapsedGroups.has(toggleId));
    const isDefaultProjectsGroup = !group.id && !hasWorkspaceGroups;
    const groupName = isDefaultProjectsGroup ? String(t("projects.title")) : group.name;

    if (isDefaultProjectsGroup) {
      return group.workspaces.map((workspace) => {
        const scopedKey = `${surface}:${workspace.id}`;
        const hasScopedCollapse = duplicateWorkspaceIds.has(workspace.id);
        return (
          <SidebarWorkspaceEntry
            key={scopedKey}
            surface={surface}
            workspace={workspace}
            isCollapsedOverride={
              hasScopedCollapse
                ? (surfaceCollapsedByKey[scopedKey] ?? workspace.settings.sidebarCollapsed)
                : undefined
            }
            onToggleWorkspaceCollapseOverride={
              hasScopedCollapse
                ? (collapsed) => {
                    setSurfaceCollapsedByKey((current) => ({
                      ...current,
                      [scopedKey]: collapsed,
                    }));
                  }
                : undefined
            }
            {...entryProps}
          />
        );
      });
    }

    return (
      <WorkspaceGroup
        key={`${surface}:${group.id ?? "ungrouped"}`}
        toggleId={toggleId}
        name={groupName}
        labelClassName={isDefaultProjectsGroup ? "workspace-group-label-projects" : undefined}
        showHeader={showGroupHeader}
        isCollapsed={isGroupCollapsed}
        onToggleCollapse={toggleGroupCollapse}
      >
        {group.workspaces.map((workspace) => {
          const scopedKey = `${surface}:${workspace.id}`;
          const hasScopedCollapse = duplicateWorkspaceIds.has(workspace.id);
          return (
            <SidebarWorkspaceEntry
              key={scopedKey}
              surface={surface}
              workspace={workspace}
              isCollapsedOverride={
                hasScopedCollapse
                  ? (surfaceCollapsedByKey[scopedKey] ?? workspace.settings.sidebarCollapsed)
                  : undefined
              }
              onToggleWorkspaceCollapseOverride={
                hasScopedCollapse
                  ? (collapsed) => {
                      setSurfaceCollapsedByKey((current) => ({
                        ...current,
                        [scopedKey]: collapsed,
                      }));
                    }
                  : undefined
              }
              {...entryProps}
            />
          );
        })}
      </WorkspaceGroup>
    );
  });
}

export function SidebarWorkspaceGroups({
  groups,
  hasWorkspaceGroups,
  collapsedGroups,
  ungroupedCollapseId,
  toggleGroupCollapse,
  ...entryProps
}: SidebarWorkspaceGroupsProps) {
  const { t } = useI18nSafe();
  const codexGroups = groups
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter((workspace) =>
        belongsToSurface(workspace, "codex"),
      ),
    }))
    .filter((group) => group.workspaces.length > 0);
  const claudeGroups = groups
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter((workspace) =>
        belongsToSurface(workspace, "claude_code"),
      ),
    }))
    .filter((group) => group.workspaces.length > 0);
  const duplicateWorkspaceIds = useMemo(() => {
    const counts = new Map<string, number>();
    [...codexGroups, ...claudeGroups].forEach((group) => {
      group.workspaces.forEach((workspace) => {
        counts.set(workspace.id, (counts.get(workspace.id) ?? 0) + 1);
      });
    });
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([workspaceId]) => workspaceId),
    );
  }, [claudeGroups, codexGroups]);
  const [surfaceCollapsedByKey, setSurfaceCollapsedByKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSurfaceCollapsedByKey((current) => {
      let changed = false;
      const next = { ...current };
      [...codexGroups, ...claudeGroups].forEach((group) => {
        group.workspaces.forEach((workspace) => {
          if (!duplicateWorkspaceIds.has(workspace.id)) {
            return;
          }
          const scopedKey = `${workspace.source}:${workspace.id}`;
          if (scopedKey in next) {
            return;
          }
          next[scopedKey] = workspace.settings.sidebarCollapsed;
          changed = true;
        });
      });
      return changed ? next : current;
    });
  }, [claudeGroups, codexGroups, duplicateWorkspaceIds]);

  return (
    <WorkspaceGroup
      toggleId={null}
      name={String(t("projects.title"))}
      labelClassName="workspace-group-label-projects"
      headerClassName="workspace-group-header-projects"
      showHeader
      isCollapsed={false}
      onToggleCollapse={toggleGroupCollapse}
      hideToggle
    >
      {renderWorkspaceSections({
        groups: codexGroups,
        hasWorkspaceGroups,
        collapsedGroups,
        ungroupedCollapseId,
        toggleGroupCollapse,
        surface: "codex",
        t,
        duplicateWorkspaceIds,
        surfaceCollapsedByKey,
        setSurfaceCollapsedByKey,
        entryProps,
      })}
      {renderWorkspaceSections({
        groups: claudeGroups,
        hasWorkspaceGroups,
        collapsedGroups,
        ungroupedCollapseId,
        toggleGroupCollapse,
        surface: "claude_code",
        t,
        duplicateWorkspaceIds,
        surfaceCollapsedByKey,
        setSurfaceCollapsedByKey,
        entryProps,
      })}
    </WorkspaceGroup>
  );
}
