import type { ComponentProps } from "react";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import { MainHeaderActions } from "@app/components/MainHeaderActions";
import { WorkspaceHome } from "@/features/workspaces/components/WorkspaceHome";

type UseMainAppDisplayNodesArgs = {
  showCompactChatThreadActions: boolean;
  handleMobileThreadRefresh: () => void;
  mobileThreadRefreshLoading: boolean;
  centerMode: "chat" | "diff";
  gitDiffViewStyle: "split" | "unified";
  setGitDiffViewStyle: (style: "split" | "unified") => void;
  isCompact: boolean;
  rightPanelCollapsed: boolean;
  sidebarToggleProps: Parameters<typeof MainHeaderActions>[0]["sidebarToggleProps"];
  workspaceHomeProps: ComponentProps<typeof WorkspaceHome> | null;
};

export function useMainAppDisplayNodes({
  showCompactChatThreadActions,
  handleMobileThreadRefresh,
  mobileThreadRefreshLoading,
  centerMode,
  gitDiffViewStyle,
  setGitDiffViewStyle,
  isCompact,
  rightPanelCollapsed,
  sidebarToggleProps,
  workspaceHomeProps,
}: UseMainAppDisplayNodesArgs) {
  const mainHeaderActionsNode = (
    <>
      {showCompactChatThreadActions ? (
        <button
          type="button"
          className="ghost main-header-action ds-tooltip-trigger"
          onClick={handleMobileThreadRefresh}
          data-tauri-drag-region="false"
          aria-label="Refresh current thread from server"
          title="Refresh current thread from server"
          data-tooltip="Refresh current thread from server"
          data-tooltip-placement="bottom"
          disabled={mobileThreadRefreshLoading}
        >
          <RefreshCw
            className={`compact-chat-refresh-icon${mobileThreadRefreshLoading ? " spinning" : ""}`}
            size={14}
            aria-hidden
          />
        </button>
      ) : null}
      {sidebarToggleProps.sidebarCollapsed ? (
        <MainHeaderActions
          centerMode={centerMode}
          gitDiffViewStyle={gitDiffViewStyle}
          onSelectDiffViewStyle={setGitDiffViewStyle}
          isCompact={isCompact}
          rightPanelCollapsed={rightPanelCollapsed}
          sidebarToggleProps={sidebarToggleProps}
        />
      ) : centerMode === "diff" || !isCompact ? (
        <MainHeaderActions
          centerMode={centerMode}
          gitDiffViewStyle={gitDiffViewStyle}
          onSelectDiffViewStyle={setGitDiffViewStyle}
          isCompact={isCompact}
          rightPanelCollapsed={rightPanelCollapsed}
          sidebarToggleProps={sidebarToggleProps}
        />
      ) : null}
    </>
  );

  const workspaceHomeNode = workspaceHomeProps ? <WorkspaceHome {...workspaceHomeProps} /> : null;

  return {
    mainHeaderActionsNode,
    workspaceHomeNode,
  };
}
