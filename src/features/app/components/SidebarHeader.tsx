import { useEffect, useState } from "react";
import Bot from "lucide-react/dist/esm/icons/bot";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import ListTree from "lucide-react/dist/esm/icons/list-tree";
import Notebook from "lucide-react/dist/esm/icons/notebook";
import Package from "lucide-react/dist/esm/icons/package";
import SquarePen from "lucide-react/dist/esm/icons/square-pen";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type { WorkspaceSurface } from "@/types";
import { ModalShell } from "@/features/design-system/components/modal/ModalShell";
import type { WorkspaceInfo } from "../../../types";

type SidebarHeaderProps = {
  onAddWorkspace: (surface: WorkspaceSurface) => void;
  onCreateCodexThread: (workspace: WorkspaceInfo) => void;
  currentWorkspace: WorkspaceInfo | null;
  currentSurface: WorkspaceSurface;
  canCreateThread: boolean;
  onOpenSkillsStore: () => void;
  onOpenAutomation: () => void;
  onCollapseSidebar: () => void;
  sidebarViewMode: "workspace" | "files";
  onSidebarViewModeChange: (mode: "workspace" | "files") => void;
  showPrimaryActions?: boolean;
};

export function SidebarHeader({
  onAddWorkspace,
  onCreateCodexThread,
  currentWorkspace,
  canCreateThread,
  onOpenSkillsStore,
  onOpenAutomation,
  onCollapseSidebar,
  sidebarViewMode,
  onSidebarViewModeChange,
  showPrimaryActions = true,
}: SidebarHeaderProps) {
  const { t } = useI18nSafe();
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);

  useEffect(() => {
    if (!isProviderPickerOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProviderPickerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isProviderPickerOpen]);

  const handleCreateThread = () => {
    if (!currentWorkspace) {
      return;
    }
    onCreateCodexThread(currentWorkspace);
  };

  const handleProviderSelect = (surface: WorkspaceSurface) => {
    setIsProviderPickerOpen(false);
    onAddWorkspace(surface);
  };

  return (
    <div>
      <div className="sidebar-header">
        <div className="sidebar-header-title">
          {showPrimaryActions && (
            <div className="sidebar-primary-nav" aria-label="Primary sidebar navigation">
              <button
                className="sidebar-function-card-item"
                onClick={handleCreateThread}
                data-tauri-drag-region="false"
                aria-label={String(t("sidebar.newChat"))}
                disabled={!canCreateThread}
                type="button"
              >
                <span className="sidebar-function-card-icon" aria-hidden>
                  <SquarePen strokeWidth={1.7} />
                </span>
                <span>{String(t("sidebar.newChat"))}</span>
              </button>
              <button
                className="sidebar-function-card-item"
                onClick={onOpenSkillsStore}
                data-tauri-drag-region="false"
                aria-label={String(t("sidebar.plugins"))}
                type="button"
              >
                <span className="sidebar-function-card-icon" aria-hidden>
                  <Package strokeWidth={1.7} />
                </span>
                <span>{String(t("sidebar.plugins"))}</span>
              </button>
              <button
                className="sidebar-function-card-item"
                onClick={onOpenAutomation}
                data-tauri-drag-region="false"
                aria-label={String(t("sidebar.automation"))}
                type="button"
              >
                <span className="sidebar-function-card-icon" aria-hidden>
                  <Notebook strokeWidth={1.7} />
                </span>
                <span>{String(t("sidebar.automation"))}</span>
              </button>
              <button
                className="sidebar-function-card-item"
                onClick={() => setIsProviderPickerOpen(true)}
                data-tauri-drag-region="false"
                aria-label={String(t("sidebar.addWorkspaces"))}
                type="button"
              >
                <span className="sidebar-function-card-icon" aria-hidden>
                  <FolderPlus strokeWidth={1.7} />
                </span>
                <span>{String(t("sidebar.addWorkspaces"))}</span>
              </button>
            </div>
          )}
        </div>
        <div className="sidebar-header-actions">
          <div className="sidebar-header-actions-left">
            <button
              type="button"
              className="ghost main-header-action sidebar-collapse-button sidebar-view-toggle-button ds-tooltip-trigger"
              onClick={() =>
                onSidebarViewModeChange(sidebarViewMode === "workspace" ? "files" : "workspace")
              }
              data-tauri-drag-region="false"
              aria-label={String(t(sidebarViewMode === "workspace" ? "sidebar.showFileTree" : "sidebar.showWorkspace"))}
              title={String(t(sidebarViewMode === "workspace" ? "sidebar.showFileTree" : "sidebar.showWorkspace"))}
              data-tooltip={String(t(sidebarViewMode === "workspace" ? "sidebar.showFileTree" : "sidebar.showWorkspace"))}
              data-tooltip-align="end"
              data-tooltip-placement="bottom"
            >
              <ListTree size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="ghost main-header-action sidebar-collapse-button sidebar-panel-toggle-button ds-tooltip-trigger"
              onClick={onCollapseSidebar}
              data-tauri-drag-region="false"
              aria-label={String(t("sidebar.hideSidebar"))}
              title={String(t("sidebar.hideSidebar"))}
              data-tooltip={String(t("sidebar.hideSidebar"))}
              data-tooltip-align="end"
              data-tooltip-placement="bottom"
            >
              <PanelLeftClose size={14} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      {isProviderPickerOpen && (
        <ModalShell
          className="workspace-provider-picker"
          cardClassName="workspace-provider-picker-card"
          onBackdropClick={() => setIsProviderPickerOpen(false)}
          ariaLabel={String(t("sidebar.chooseProjectProvider"))}
        >
          <div className="ds-modal-title">{String(t("sidebar.chooseProjectProvider"))}</div>
          <div className="ds-modal-subtitle">{String(t("sidebar.chooseProjectProviderHint"))}</div>
          <div className="workspace-provider-picker-options">
            <button
              className="workspace-provider-picker-option"
              type="button"
              onClick={() => handleProviderSelect("codex")}
            >
              <span className="workspace-provider-picker-icon is-openai" aria-hidden>
                <Sparkles strokeWidth={1.7} />
              </span>
              <span className="workspace-provider-picker-copy">
                <strong>OpenAI</strong>
                <span>适合编程、自媒体内容和写作类任务</span>
              </span>
            </button>
            <button
              className="workspace-provider-picker-option"
              type="button"
              onClick={() => handleProviderSelect("claude_code")}
            >
              <span className="workspace-provider-picker-icon is-anthropic" aria-hidden>
                <Bot strokeWidth={1.7} />
              </span>
              <span className="workspace-provider-picker-copy">
                <strong>Anthropic</strong>
                <span>适合编程、数学推理和复杂分析类任务</span>
              </span>
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
