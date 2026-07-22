import { useEffect, useState } from "react";
import type { DebugEntry, WorkspaceInfo } from "../../../types";
import { useWorkspaceFiles } from "../../workspaces/hooks/useWorkspaceFiles";

type TabKey = "home" | "projects" | "chat" | "git" | "log";
type TabletTabKey = "chat" | "git" | "log";

type UseWorkspaceFileListingArgs = {
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  sidebarViewMode: "workspace" | "files";
  isCompact: boolean;
  isTablet: boolean;
  activeTab: TabKey;
  tabletTab: TabletTabKey;
  rightPanelCollapsed: boolean;
  hasComposerSurface: boolean;
  onDebug?: (entry: DebugEntry) => void;
};

type UseWorkspaceFileListingResult = {
  files: string[];
  isLoading: boolean;
  setFileAutocompleteActive: (active: boolean) => void;
};

export function useWorkspaceFileListing({
  activeWorkspace,
  activeWorkspaceId,
  sidebarViewMode,
  isCompact,
  isTablet,
  activeTab,
  tabletTab,
  rightPanelCollapsed,
  hasComposerSurface,
  onDebug,
}: UseWorkspaceFileListingArgs): UseWorkspaceFileListingResult {
  const [fileAutocompleteActive, setFileAutocompleteActive] = useState(false);

  const compactTab = isTablet ? tabletTab : activeTab;
  const filePanelVisible =
    sidebarViewMode === "files" &&
    (isCompact ? compactTab === "git" : !rightPanelCollapsed);
  const shouldFetchFiles =
    Boolean(activeWorkspace) && (sidebarViewMode === "files" || fileAutocompleteActive);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setFileAutocompleteActive(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!hasComposerSurface) {
      setFileAutocompleteActive(false);
    }
  }, [hasComposerSurface]);

  const { files, isLoading } = useWorkspaceFiles({
    activeWorkspace,
    onDebug,
    enabled: shouldFetchFiles,
    pollingEnabled: filePanelVisible,
  });

  return { files, isLoading, setFileAutocompleteActive };
}
