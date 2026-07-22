import { useEffect, useRef } from "react";
import type { WorkspaceInfo } from "../../../types";

const INITIAL_THREAD_LIST_MAX_PAGES = 6;

type WorkspaceRestoreOptions = {
  workspaces: WorkspaceInfo[];
  hasLoaded: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  listThreadsForWorkspaces: (
    workspaces: WorkspaceInfo[],
    options?: { preserveState?: boolean; maxPages?: number },
  ) => Promise<void>;
};

export function useWorkspaceRestore({
  workspaces,
  hasLoaded,
  connectWorkspace,
  listThreadsForWorkspaces,
}: WorkspaceRestoreOptions) {
  const restoredWorkspaces = useRef(new Set<string>());

  useEffect(() => {
    const knownWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
    for (const workspaceId of Array.from(restoredWorkspaces.current)) {
      if (!knownWorkspaceIds.has(workspaceId)) {
        restoredWorkspaces.current.delete(workspaceId);
      }
    }
    workspaces.forEach((workspace) => {
      if (!workspace.connected) {
        restoredWorkspaces.current.delete(workspace.id);
      }
    });
  }, [workspaces]);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    const pending = workspaces.filter(
      (workspace) => !restoredWorkspaces.current.has(workspace.id),
    );
    if (pending.length === 0) {
      return;
    }
    pending.forEach((workspace) => {
      restoredWorkspaces.current.add(workspace.id);
    });
    void (async () => {
      const connectedTargets: WorkspaceInfo[] = [];
      for (const workspace of pending) {
        if (workspace.source === "claude_code") {
          connectedTargets.push({ ...workspace, connected: true });
          continue;
        }
        const wasConnected = workspace.connected;
        try {
          if (!wasConnected) {
            await connectWorkspace(workspace);
          }
          connectedTargets.push({ ...workspace, connected: true });
        } catch {
          // Silent: connection errors show in debug panel.
        }
      }
      if (connectedTargets.length > 0) {
        await listThreadsForWorkspaces(connectedTargets, {
          maxPages: INITIAL_THREAD_LIST_MAX_PAGES,
        });
      }
    })();
  }, [connectWorkspace, hasLoaded, listThreadsForWorkspaces, workspaces]);
}
