import type {
  RequestUserInputRequest,
  ThreadListOrganizeMode,
  ThreadListSortKey,
  ThreadSummary,
  WorkspaceInfo,
  WorkspaceSurface,
} from "../../../types";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { FolderOpen } from "lucide-react";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { FileTreePanel } from "@/features/layout/components/FileTreePanel";
import { SidebarBottomRail } from "./SidebarBottomRail";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarThreadsOnlySection } from "./SidebarThreadsOnlySection";
import { SidebarWorkspaceGroups } from "./SidebarWorkspaceGroups";
import { PinnedThreadList } from "./PinnedThreadList";
import {
  countRootRows,
  splitRowsByRoot,
} from "./threadSearchUtils";
import type {
  FlatThreadRootGroup,
  FlatThreadRow,
  SidebarOverlayMenuAnchor,
  ThreadBucket,
  WorkspaceGroupSection,
} from "./sidebarTypes";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useMenuController } from "../hooks/useMenuController";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { formatRelativeTimeShort } from "../../../utils/time";
import type { ThreadStatusById } from "../../../utils/threadStatus";

const COLLAPSED_GROUPS_STORAGE_KEY = "codexmonitor.collapsedGroups";
const UNGROUPED_COLLAPSE_ID = "__ungrouped__";
const ALL_THREADS_ADD_MENU_WIDTH = 220;

// 根据会话时间戳归入侧边栏“全部会话”视图中的时间分组。
function getThreadBucketId(timestamp: number, nowMs: number): ThreadBucket["id"] {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;

  if (timestamp >= nowMs - 60 * 60 * 1000) {
    return "now";
  }
  if (timestamp >= startOfToday) {
    return "today";
  }
  if (timestamp >= startOfYesterday) {
    return "yesterday";
  }
  if (timestamp >= startOfWeek) {
    return "week";
  }
  return "older";
}

// 将扁平化后的根会话组按时间桶合并，供“全部会话”模式分段展示。
function groupFlatThreadRowsByTimeBucket(
  groups: FlatThreadRootGroup[],
  nowMs: number,
): ThreadBucket[] {
  const bucketLabels: Record<ThreadBucket["id"], string> = {
    now: "Now",
    today: "Earlier today",
    yesterday: "Yesterday",
    week: "This week",
    older: "Older",
  };
  const order: ThreadBucket["id"][] = ["now", "today", "yesterday", "week", "older"];
  const bucketMap = new Map<ThreadBucket["id"], FlatThreadRow[]>();

  groups.forEach((group) => {
    const bucketId = getThreadBucketId(group.rootTimestamp, nowMs);
    const list = bucketMap.get(bucketId) ?? [];
    list.push(...group.rows);
    bucketMap.set(bucketId, list);
  });

  return order
    .filter((bucketId) => (bucketMap.get(bucketId) ?? []).length > 0)
    .map((bucketId) => ({
      id: bucketId,
      label: bucketLabels[bucketId],
      rows: bucketMap.get(bucketId) ?? [],
    }));
}

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId?: string | null;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: ThreadStatusById;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  pinnedThreadsVersion: number;
  threadListSortKey: ThreadListSortKey;
  threadListOrganizeMode: ThreadListOrganizeMode;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  sidebarViewMode: "workspace" | "files";
  onSidebarViewModeChange: (mode: "workspace" | "files") => void;
  userInputRequests?: RequestUserInputRequest[];
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  onAddWorkspace: (surface: WorkspaceSurface) => void;
  onOpenSkillsStore: () => void;
  onOpenAutomation: () => void;
  onSelectWorkspace: (id: string) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => Promise<void>;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  getThreadArgsBadge?: (workspaceId: string, threadId: string) => string | null;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
  fileTreeProps?: {
    workspaceId: string;
    workspacePath: string;
    files: string[];
    modifiedFiles: string[];
    isLoading: boolean;
    onInsertText?: (text: string) => void;
    onAttachFile?: (path: string) => void;
    canInsertText: boolean;
    onPreviewFile?: (path: string) => void;
  } | null;
  sidebarCollapsed?: boolean;
  onCollapseSidebar: () => void;
  mobileProjectsOnly?: boolean;
};

// 侧边栏主组件：负责项目/文件视图切换、置顶会话、项目分组和底部工具栏的组合渲染。
export const Sidebar = memo(function Sidebar({
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId = null,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  pinnedThreadsVersion,
  threadListSortKey,
  threadListOrganizeMode,
  activeWorkspaceId,
  activeThreadId,
  sidebarViewMode,
  onSidebarViewModeChange,
  userInputRequests = [],
  onOpenSettings,
  onOpenDebug,
  showDebugButton,
  onAddWorkspace,
  onOpenSkillsStore,
  onOpenAutomation,
  onSelectWorkspace,
  onAddAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  getPinTimestamp,
  getThreadArgsBadge,
  onRenameThread,
  onDeleteWorkspace,
  onDeleteWorktree,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
  fileTreeProps = null,
  onCollapseSidebar,
  mobileProjectsOnly = false,
}: SidebarProps) {
  const { currentLanguage } = useI18nSafe();
  const { t } = useI18nSafe();
  const [allThreadsAddMenuAnchor, setAllThreadsAddMenuAnchor] =
    useState<SidebarOverlayMenuAnchor | null>(null);
  const allThreadsAddMenuOpen = Boolean(allThreadsAddMenuAnchor);
  const allThreadsAddMenuController = useMenuController({
    open: Boolean(allThreadsAddMenuAnchor),
    onDismiss: () => setAllThreadsAddMenuAnchor(null),
  });
  const { containerRef: allThreadsAddMenuRef } = allThreadsAddMenuController;
  const { collapsedGroups, toggleGroupCollapse } = useCollapsedGroups(
    COLLAPSED_GROUPS_STORAGE_KEY,
  );
  const { getThreadRows } = useThreadRows(threadParentById);
  const {
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    showCloneMenu,
  } =
    useSidebarMenus({
      workspaces,
      onDeleteThread,
      onSyncThread,
      onPinThread: pinThread,
      onUnpinThread: unpinThread,
      isThreadPinned,
      onRenameThread,
      onReloadWorkspaceThreads,
      onDeleteWorkspace,
      onDeleteWorktree,
    });
  // 将等待用户输入的请求映射成 workspaceId:threadId，方便会话行快速判断状态。
  const pendingUserInputKeys = useMemo(
    () =>
      new Set(
        userInputRequests
          .map((request) => {
            const workspaceId = request.workspace_id.trim();
            const threadId = request.params.thread_id.trim();
            return workspaceId && threadId ? `${workspaceId}:${threadId}` : "";
          })
          .filter(Boolean),
      ),
    [userInputRequests],
  );

  // 从所有工作区中收集置顶会话，并按置顶时间稳定排序后交给置顶区渲染。
  const pinnedThreadRows = useMemo(() => {
    type ThreadRow = { thread: ThreadSummary; depth: number };
    const groups: Array<{
      pinTime: number;
      workspaceId: string;
      workspaceName: string;
      rows: ThreadRow[];
    }> = [];

    workspaces.forEach((workspace) => {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      if (!threads.length) {
        return;
      }
      const { pinnedRows } = getThreadRows(
        threads,
        workspace.id,
        getPinTimestamp,
        pinnedThreadsVersion,
      );
      if (!pinnedRows.length) {
        return;
      }
      splitRowsByRoot(pinnedRows).forEach((group) => {
        const pinTime = getPinTimestamp(workspace.id, group.root.thread.id);
        if (pinTime === null) {
          return;
        }
        groups.push({
          pinTime,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          rows: group.rows,
        });
      });
    });

    return groups
      .sort((a, b) => a.pinTime - b.pinTime)
      .flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          workspaceId: group.workspaceId,
        })),
      );
  }, [
    workspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    pinnedThreadsVersion,
  ]);

  const filteredGroupedWorkspaces = useMemo(
    () => groupedWorkspaces,
    [groupedWorkspaces],
  );

  const getSortTimestamp = useCallback(
    (thread: ThreadSummary | undefined) => {
      if (!thread) {
        return 0;
      }
      if (threadListSortKey === "created_at") {
        return thread.createdAt ?? thread.updatedAt ?? 0;
      }
      return thread.updatedAt ?? thread.createdAt ?? 0;
    },
    [threadListSortKey],
  );

  // 计算每个项目最近的会话活跃时间，项目活跃度排序会使用主项目及其克隆项目的最新会话。
  const workspaceActivityById = useMemo(() => {
    const activityById = new Map<
      string,
      {
        hasThreads: boolean;
        timestamp: number;
      }
    >();
    const workspaceById = new Map<string, WorkspaceInfo>();
    workspaces.forEach((workspace) => {
      workspaceById.set(workspace.id, workspace);
    });

    const cloneWorkspacesBySourceId = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "main")
      .forEach((entry) => {
        const sourceId = entry.settings.cloneSourceWorkspaceId?.trim();
        if (!sourceId || sourceId === entry.id || !workspaceById.has(sourceId)) {
          return;
        }
        const list = cloneWorkspacesBySourceId.get(sourceId) ?? [];
        list.push(entry);
        cloneWorkspacesBySourceId.set(sourceId, list);
      });

    filteredGroupedWorkspaces.forEach((group) => {
      group.workspaces.forEach((workspace) => {
        const rootThreads = threadsByWorkspace[workspace.id] ?? [];
        const visibleClones = cloneWorkspacesBySourceId.get(workspace.id) ?? [];
        let hasThreads = rootThreads.length > 0;
        let timestamp = getSortTimestamp(rootThreads[0]);

        visibleClones.forEach((clone) => {
          const cloneThreads = threadsByWorkspace[clone.id] ?? [];
          if (!cloneThreads.length) {
            return;
          }
          hasThreads = true;
          timestamp = Math.max(timestamp, getSortTimestamp(cloneThreads[0]));
        });

        activityById.set(workspace.id, {
          hasThreads,
          timestamp,
        });
      });
    });
    return activityById;
  }, [
    filteredGroupedWorkspaces,
    getSortTimestamp,
    threadsByWorkspace,
    workspaces,
  ]);

  const sortedGroupedWorkspaces = useMemo(() => {
    if (threadListOrganizeMode !== "by_project_activity") {
      return filteredGroupedWorkspaces;
    }
    return filteredGroupedWorkspaces.map((group) => ({
      ...group,
      workspaces: group.workspaces.slice().sort((a, b) => {
        const aActivity = workspaceActivityById.get(a.id) ?? {
          hasThreads: false,
          timestamp: 0,
        };
        const bActivity = workspaceActivityById.get(b.id) ?? {
          hasThreads: false,
          timestamp: 0,
        };
        if (aActivity.hasThreads !== bActivity.hasThreads) {
          return aActivity.hasThreads ? -1 : 1;
        }
        const timestampDiff = bActivity.timestamp - aActivity.timestamp;
        if (timestampDiff !== 0) {
          return timestampDiff;
        }
        return a.name.localeCompare(b.name);
      }),
    }));
  }, [filteredGroupedWorkspaces, threadListOrganizeMode, workspaceActivityById]);

  // “全部会话”模式下，将各项目的未置顶会话抽成统一列表，同时保留所属项目信息。
  const flatThreadRootGroups = useMemo(() => {
    if (threadListOrganizeMode !== "threads_only") {
      return [] as FlatThreadRootGroup[];
    }

    const rootGroups: FlatThreadRootGroup[] = [];

    filteredGroupedWorkspaces.forEach((group) => {
      group.workspaces.forEach((workspace) => {
        const threads = threadsByWorkspace[workspace.id] ?? [];
        if (!threads.length) {
          return;
        }
        const { unpinnedRows } = getThreadRows(
          threads,
          workspace.id,
          getPinTimestamp,
          pinnedThreadsVersion,
        );
        if (!unpinnedRows.length) {
          return;
        }

        splitRowsByRoot(unpinnedRows).forEach((group) => {
          rootGroups.push({
            rootTimestamp: getSortTimestamp(group.root.thread),
            workspaceName: workspace.name,
            workspaceId: workspace.id,
            rootIndex: group.rootIndex,
            rows: group.rows.map((row) => ({
              ...row,
              workspaceId: workspace.id,
              workspaceName: workspace.name,
            })),
          });
        });
      });
    });

    return rootGroups
      .sort((a, b) => {
        const timestampDiff = b.rootTimestamp - a.rootTimestamp;
        if (timestampDiff !== 0) {
          return timestampDiff;
        }
        const workspaceNameDiff = a.workspaceName.localeCompare(b.workspaceName);
        if (workspaceNameDiff !== 0) {
          return workspaceNameDiff;
        }
        return a.rootIndex - b.rootIndex;
      });
  }, [
    filteredGroupedWorkspaces,
    getPinTimestamp,
    getSortTimestamp,
    getThreadRows,
    pinnedThreadsVersion,
    threadListOrganizeMode,
    threadsByWorkspace,
  ]);
  const flatThreadRows = useMemo(
    () => flatThreadRootGroups.flatMap((group) => group.rows),
    [flatThreadRootGroups],
  );
  const threadBuckets = useMemo(
    () => groupFlatThreadRowsByTimeBucket(flatThreadRootGroups, Date.now()),
    [flatThreadRootGroups],
  );

  // 侧边栏内容变化时重新计算滚动阴影，避免顶部/底部渐隐状态滞后。
  const scrollFadeDeps = useMemo(
    () => [
      sortedGroupedWorkspaces,
      flatThreadRows,
      threadsByWorkspace,
      threadListOrganizeMode,
    ],
    [
      sortedGroupedWorkspaces,
      flatThreadRows,
      threadsByWorkspace,
      threadListOrganizeMode,
    ],
  );
  const { sidebarBodyRef, scrollFade, updateScrollFade } =
    useSidebarScrollFade(scrollFadeDeps);

  const workspaceNameById = useMemo(() => {
    const byId = new Map<string, string>();
    workspaces.forEach((workspace) => {
      byId.set(workspace.id, workspace.name);
    });
    return byId;
  }, [workspaces]);
  const getWorkspaceLabel = useCallback(
    (workspaceId: string) => workspaceNameById.get(workspaceId) ?? null,
    [workspaceNameById],
  );

  const groupedWorkspacesForRender =
    threadListOrganizeMode === "by_project_activity"
      ? sortedGroupedWorkspaces
      : filteredGroupedWorkspaces;
  const isThreadsOnlyMode = threadListOrganizeMode === "threads_only";

  // 打开“全部会话”模式的新建菜单，并把菜单位置限制在视口范围内。
  const handleAllThreadsAddMenuToggle = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (allThreadsAddMenuOpen) {
        setAllThreadsAddMenuAnchor(null);
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.left, 12),
        window.innerWidth - ALL_THREADS_ADD_MENU_WIDTH - 12,
      );
      const top = rect.bottom + 8;
      setAllThreadsAddMenuAnchor({
        top,
        left,
        width: ALL_THREADS_ADD_MENU_WIDTH,
      });
    },
    [allThreadsAddMenuOpen],
  );

  // 在“全部会话”模式中选择项目后，关闭菜单并创建该项目的新会话。
  const handleCreateThreadInProject = useCallback(
    (workspace: WorkspaceInfo) => {
      setAllThreadsAddMenuAnchor(null);
      onAddAgent(workspace);
    },
    [onAddAgent],
  );

  // 按父项目聚合 worktree，侧边栏项目树用它渲染派生工作区。
  const worktreesByParent = useMemo(() => {
    const worktrees = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "worktree" && entry.parentId)
      .forEach((entry) => {
        const parentId = entry.parentId as string;
        const list = worktrees.get(parentId) ?? [];
        list.push(entry);
        worktrees.set(parentId, list);
      });
    worktrees.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });
    return worktrees;
  }, [workspaces]);

  // 按来源项目聚合 clone，并记录 clone 子项目，避免在主项目列表中重复展示。
  const { clonesBySource, cloneChildIds } = useMemo(() => {
    const workspaceById = new Map<string, WorkspaceInfo>();
    workspaces.forEach((workspace) => {
      workspaceById.set(workspace.id, workspace);
    });

    const clones = new Map<string, WorkspaceInfo[]>();
    const cloneIds = new Set<string>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "main")
      .forEach((entry) => {
        const sourceId = entry.settings.cloneSourceWorkspaceId?.trim();
        if (!sourceId || sourceId === entry.id || !workspaceById.has(sourceId)) {
          return;
        }
        const list = clones.get(sourceId) ?? [];
        list.push(entry);
        clones.set(sourceId, list);
        cloneIds.add(entry.id);
      });

    clones.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });

    return { clonesBySource: clones, cloneChildIds: cloneIds };
  }, [workspaces]);

  // “全部会话”新建菜单只列出可直接创建会话的主项目。
  const projectOptionsForNewThread = useMemo(() => {
    const seen = new Set<string>();
    const projects: WorkspaceInfo[] = [];
    groupedWorkspacesForRender.forEach((group) => {
      group.workspaces.forEach((entry) => {
        if ((entry.kind ?? "main") !== "main") {
          return;
        }
        if (cloneChildIds.has(entry.id) || seen.has(entry.id)) {
          return;
        }
        seen.add(entry.id);
        projects.push(entry);
      });
    });
    return projects;
  }, [cloneChildIds, groupedWorkspacesForRender]);

  const handleHeaderCreateCodexThread = useCallback(
    (workspace: WorkspaceInfo) => {
      onSidebarViewModeChange("workspace");
      onAddAgent(workspace);
    },
    [onAddAgent, onSidebarViewModeChange],
  );

  const currentWorkspaceForHeader = useMemo(() => {
    if (!activeWorkspaceId) {
      return projectOptionsForNewThread[0] ?? null;
    }
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  }, [activeWorkspaceId, projectOptionsForNewThread, workspaces]);

  const currentSurfaceForHeader = useMemo<WorkspaceSurface>(() => "codex", []);

  const getThreadTime = useCallback(
    (thread: ThreadSummary) => {
      const timestamp = thread.updatedAt ?? null;
      return timestamp ? formatRelativeTimeShort(timestamp, currentLanguage) : null;
    },
    [currentLanguage],
  );
  const pinnedRootCount = useMemo(() => countRootRows(pinnedThreadRows), [pinnedThreadRows]);

  // “全部会话”新建菜单同样在滚动时关闭，保持浮层位置可靠。
  useEffect(() => {
    if (!allThreadsAddMenuAnchor) {
      return;
    }
    function handleScroll() {
      setAllThreadsAddMenuAnchor(null);
    }
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [allThreadsAddMenuAnchor]);

  return (
    <aside
      className={`sidebar${mobileProjectsOnly ? " sidebar-mobile-projects-only" : ""}`}
      ref={workspaceDropTargetRef}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <div className="sidebar-drag-strip" />
      <SidebarHeader
        onAddWorkspace={onAddWorkspace}
        onCreateCodexThread={handleHeaderCreateCodexThread}
        currentWorkspace={currentWorkspaceForHeader}
        currentSurface={currentSurfaceForHeader}
        canCreateThread={projectOptionsForNewThread.length > 0}
        onOpenSkillsStore={onOpenSkillsStore}
        onOpenAutomation={onOpenAutomation}
        onCollapseSidebar={onCollapseSidebar}
        sidebarViewMode={sidebarViewMode}
        onSidebarViewModeChange={onSidebarViewModeChange}
        showPrimaryActions={!mobileProjectsOnly}
      />
      {/* 拖拽项目到侧边栏时显示的投放提示层。 */}
      <div
        className={`workspace-drop-overlay${
          isWorkspaceDropActive ? " is-active" : ""
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text${
            workspaceDropText === "Adding Project..." ? " is-busy" : ""
          }`}
        >
          {workspaceDropText === "Drop Project Here" && (
            <FolderOpen className="workspace-drop-overlay-icon" aria-hidden />
          )}
          {workspaceDropText}
        </div>
      </div>
      <div
        className={`sidebar-body${scrollFade.top ? " fade-top" : ""}${
          scrollFade.bottom ? " fade-bottom" : ""
        }`}
        onScroll={updateScrollFade}
        ref={sidebarBodyRef}
      >
        {/* 根据当前视图渲染文件树或会话/项目列表。 */}
        {sidebarViewMode === "files" && fileTreeProps ? (
          // 文件视图：展示当前工作区的文件树，并隐藏文件面板标签页。
          <FileTreePanel
            {...fileTreeProps}
            filePanelMode="preview"
            onFilePanelModeChange={() => {}}
            showPanelTabs={false}
          />
        ) : (
          <div className="workspace-list">
            {pinnedThreadRows.length > 0 && (
              // 置顶会话区：跨项目展示所有已置顶的根会话。
              <div className="pinned-section">
                <div className="sidebar-section-header">
                  <div className="sidebar-section-title">
                    {String(t("sidebar.pinnedConversations"))}
                  </div>
                  <div className="sidebar-section-count">{pinnedRootCount}</div>
                </div>
                <PinnedThreadList /**/
                  rows={pinnedThreadRows}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  threadStatusById={threadStatusById}
                  pendingUserInputKeys={pendingUserInputKeys}
                  getThreadTime={getThreadTime}
                  getThreadArgsBadge={getThreadArgsBadge}
                  isThreadPinned={isThreadPinned}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={showThreadMenu}
                  getWorkspaceLabel={getWorkspaceLabel}
                />
              </div>
            )}
            {isThreadsOnlyMode
              ? groupedWorkspacesForRender.length > 0 && (
                  // 全部会话模式：隐藏项目树，按时间分组展示未置顶会话。
                  <SidebarThreadsOnlySection
                    threadBuckets={threadBuckets}
                    activeWorkspaceId={activeWorkspaceId}
                    activeThreadId={activeThreadId}
                    threadStatusById={threadStatusById}
                    pendingUserInputKeys={pendingUserInputKeys}
                    getThreadTime={getThreadTime}
                    getThreadArgsBadge={getThreadArgsBadge}
                    isThreadPinned={isThreadPinned}
                    onSelectThread={onSelectThread}
                    onShowThreadMenu={showThreadMenu}
                    getWorkspaceLabel={getWorkspaceLabel}
                    addMenuOpen={allThreadsAddMenuOpen}
                    addMenuAnchor={allThreadsAddMenuAnchor}
                    addMenuRef={allThreadsAddMenuRef}
                    projectOptionsForNewThread={projectOptionsForNewThread}
                    onToggleAddMenu={handleAllThreadsAddMenuToggle}
                    onCreateThreadInProject={handleCreateThreadInProject}
                  />
                )
              : (
                  // 项目模式：按项目/分组/worktree/clone 组织工作区与会话列表。
                  <SidebarWorkspaceGroups
                    groups={groupedWorkspacesForRender}
                    hasWorkspaceGroups={hasWorkspaceGroups}
                    collapsedGroups={collapsedGroups}
                    ungroupedCollapseId={UNGROUPED_COLLAPSE_ID}
                    toggleGroupCollapse={toggleGroupCollapse}
                    cloneChildIds={cloneChildIds}
                    clonesBySource={clonesBySource}
                    worktreesByParent={worktreesByParent}
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
                    newAgentDraftWorkspaceId={newAgentDraftWorkspaceId}
                    onSelectWorkspace={onSelectWorkspace}
                    onAddAgent={onAddAgent}
                    onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                    onSelectThread={onSelectThread}
                    onShowThreadMenu={showThreadMenu}
                    onShowWorkspaceMenu={showWorkspaceMenu}
                    onShowWorktreeMenu={showWorktreeMenu}
                    onShowCloneMenu={showCloneMenu}
                    onLoadOlderThreads={onLoadOlderThreads}
                  />
                )}
            {!groupedWorkspacesForRender.length && (
              <div className="empty">
                Add a workspace to start.
              </div>
            )}
            {isThreadsOnlyMode &&
              groupedWorkspacesForRender.length > 0 &&
              flatThreadRows.length === 0 &&
              pinnedThreadRows.length === 0 && (
                <div className="empty">No conversations yet.</div>
              )}
          </div>
        )}
      </div>
      {/* 底部工具栏 */}
      <SidebarBottomRail
        onOpenSettings={onOpenSettings}
        onOpenDebug={onOpenDebug}
        showDebugButton={showDebugButton}
        hidden={false}
      />
    </aside>
  );
});

Sidebar.displayName = "Sidebar";
