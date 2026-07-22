import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  DebugEntry,
  WorkspaceGroup,
  WorkspaceInfo,
  WorkspaceSettings,
  WorkspaceSurface,
} from "../../../types";
import {
  RESERVED_GROUP_NAME,
  buildGroupedWorkspaces,
  buildWorkspaceById,
  buildWorkspaceGroupById,
  getWorkspaceGroupNameById,
  sortWorkspaceGroups,
} from "../domain/workspaceGroups";
import {
  useWorkspaceCrud,
  type AddWorkspacesFromPathsResult,
} from "./useWorkspaceCrud";
import { useWorkspaceGroupOps } from "./useWorkspaceGroupOps";
import { useWorktreeOps } from "./useWorktreeOps";
import { getCurrentWorkspacePath } from "../../../services/tauri";

export type UseWorkspacesOptions = {
  onDebug?: (entry: DebugEntry) => void;
  appSettings?: AppSettings;
  onUpdateAppSettings?: (next: AppSettings) => Promise<AppSettings>;
};

export type UseWorkspacesResult = {
  workspaces: WorkspaceInfo[];
  workspaceGroups: WorkspaceGroup[];
  groupedWorkspaces: ReturnType<typeof buildGroupedWorkspaces>;
  getWorkspaceGroupName: (workspaceId: string) => string | null;
  ungroupedLabel: string;
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (workspaceId: string | null) => void;
  addWorkspaceFromPath: (path: string, options?: { activate?: boolean; surface?: WorkspaceSurface }) => Promise<WorkspaceInfo | null>;
  addWorkspaceFromGitUrl: (
    url: string,
    destinationPath: string,
    targetFolderName?: string | null,
    options?: { activate?: boolean },
  ) => Promise<WorkspaceInfo | null>;
  addWorkspacesFromPaths: (paths: string[], options?: { surface?: WorkspaceSurface }) => Promise<AddWorkspacesFromPathsResult>;
  filterWorkspacePaths: (paths: string[]) => Promise<string[]>;
  addCloneAgent: (source: WorkspaceInfo, copyName: string, copiesFolder: string) => Promise<WorkspaceInfo | null>;
  addWorktreeAgent: (
    parent: WorkspaceInfo,
    branch: string,
    options?: {
      activate?: boolean;
      displayName?: string | null;
      copyAgentsMd?: boolean;
    },
  ) => Promise<WorkspaceInfo | null>;
  connectWorkspace: (entry: WorkspaceInfo) => Promise<void>;
  markWorkspaceConnected: (id: string) => void;
  updateWorkspaceSettings: (workspaceId: string, patch: Partial<WorkspaceSettings>) => Promise<WorkspaceInfo>;
  createWorkspaceGroup: (name: string) => Promise<WorkspaceGroup | null>;
  renameWorkspaceGroup: (groupId: string, name: string) => Promise<true | null>;
  moveWorkspaceGroup: (groupId: string, direction: "up" | "down") => Promise<true | null>;
  deleteWorkspaceGroup: (groupId: string) => Promise<true | null>;
  assignWorkspaceGroup: (workspaceId: string, groupId: string | null) => Promise<true | null>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  removeWorktree: (workspaceId: string) => Promise<void>;
  renameWorktree: (workspaceId: string, branch: string) => Promise<WorkspaceInfo>;
  renameWorktreeUpstream: (workspaceId: string, oldBranch: string, newBranch: string) => Promise<void>;
  deletingWorktreeIds: Set<string>;
  hasLoaded: boolean;
  refreshWorkspaces: () => Promise<WorkspaceInfo[] | undefined>;
};

export function useWorkspaces(options: UseWorkspacesOptions = {}): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const defaultWorkspaceInitializedRef = useRef(false);
  const workspaceSettingsRef = useRef<Map<string, WorkspaceSettings>>(new Map());
  const { onDebug, appSettings, onUpdateAppSettings } = options;

  const {
    addWorkspaceFromPath,
    addWorkspaceFromGitUrl,
    addWorkspacesFromPaths,
    connectWorkspace,
    filterWorkspacePaths,
    markWorkspaceConnected,
    refreshWorkspaces,
    removeWorkspace,
    updateWorkspaceSettings,
  } = useWorkspaceCrud({
    onDebug,
    workspaces,
    setWorkspaces,
    setActiveWorkspaceId,
    workspaceSettingsRef,
    setHasLoaded,
  });

  useEffect(() => {
    void refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    if (!hasLoaded || activeWorkspaceId || defaultWorkspaceInitializedRef.current) {
      return;
    }
    defaultWorkspaceInitializedRef.current = true;

    void (async () => {
      try {
        const currentPath = await getCurrentWorkspacePath();
        await Promise.all([
          addWorkspaceFromPath(currentPath, { activate: true, surface: "codex" }),
          addWorkspaceFromPath(currentPath, { activate: false, surface: "claude_code" }),
        ]);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-default-workspace-error`,
          timestamp: Date.now(),
          source: "error",
          label: "workspace/default-current-directory error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [activeWorkspaceId, addWorkspaceFromPath, hasLoaded, onDebug]);

  useEffect(() => {
    const next = new Map<string, WorkspaceSettings>();
    workspaces.forEach((entry) => {
      next.set(entry.id, entry.settings);
    });
    workspaceSettingsRef.current = next;
  }, [workspaces]);

  const activeWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const workspaceById = useMemo(() => buildWorkspaceById(workspaces), [workspaces]);

  const workspaceGroups = useMemo(
    () => sortWorkspaceGroups(appSettings?.workspaceGroups ?? []),
    [appSettings?.workspaceGroups],
  );

  const workspaceGroupById = useMemo(
    () => buildWorkspaceGroupById(workspaceGroups),
    [workspaceGroups],
  );

  const groupedWorkspaces = useMemo(
    () => buildGroupedWorkspaces(workspaces, workspaceGroups),
    [workspaceGroups, workspaces],
  );

  const getWorkspaceGroupName = useCallback(
    (workspaceId: string) =>
      getWorkspaceGroupNameById(workspaceId, workspaceById, workspaceGroupById),
    [workspaceById, workspaceGroupById],
  );

  const {
    addCloneAgent,
    addWorktreeAgent,
    deletingWorktreeIds,
    removeWorktree,
    renameWorktree,
    renameWorktreeUpstream,
  } = useWorktreeOps({
    onDebug,
    setWorkspaces,
    setActiveWorkspaceId,
  });

  const {
    assignWorkspaceGroup,
    createWorkspaceGroup,
    deleteWorkspaceGroup,
    moveWorkspaceGroup,
    renameWorkspaceGroup,
  } = useWorkspaceGroupOps({
    appSettings,
    onUpdateAppSettings,
    workspaceGroups,
    workspaceGroupById,
    workspaces,
    updateWorkspaceSettings,
  });

  return {
    workspaces,
    workspaceGroups,
    groupedWorkspaces,
    getWorkspaceGroupName,
    ungroupedLabel: RESERVED_GROUP_NAME,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspaceFromPath,
    addWorkspaceFromGitUrl,
    addWorkspacesFromPaths,
    filterWorkspacePaths,
    addCloneAgent,
    addWorktreeAgent,
    connectWorkspace,
    markWorkspaceConnected,
    updateWorkspaceSettings,
    createWorkspaceGroup,
    renameWorkspaceGroup,
    moveWorkspaceGroup,
    deleteWorkspaceGroup,
    assignWorkspaceGroup,
    removeWorkspace,
    removeWorktree,
    renameWorktree,
    renameWorktreeUpstream,
    deletingWorktreeIds,
    hasLoaded,
    refreshWorkspaces,
  };
}
