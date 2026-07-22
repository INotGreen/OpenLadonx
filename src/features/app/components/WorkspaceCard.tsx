import type { MouseEvent } from "react";
import FolderClosed from "lucide-react/dist/esm/icons/folder-closed";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderCode from "lucide-react/dist/esm/icons/folder-code";
import SquarePen from "lucide-react/dist/esm/icons/square-pen";

import type { WorkspaceInfo, WorkspaceSurface } from "../../../types";

type WorkspaceCardProps = {
  workspace: WorkspaceInfo;
  workspaceName?: React.ReactNode;
  summary?: string | null;
  isActive: boolean;
  isCollapsed: boolean;
  surface?: WorkspaceSurface;
  onSelectWorkspace: (id: string) => void;
  onShowWorkspaceMenu: (event: MouseEvent, workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onAddAgent: (workspace: WorkspaceInfo) => void;
  children?: React.ReactNode;
};

export function WorkspaceCard({
  workspace,
  workspaceName,
  summary = null,
  isActive,
  isCollapsed,
  surface = "codex",
  onSelectWorkspace,
  onShowWorkspaceMenu,
  onToggleWorkspaceCollapse,
  onAddAgent,
  children,
}: WorkspaceCardProps) {
  const contentCollapsedClass = isCollapsed ? " collapsed" : "";
  const hasChildren = Boolean(children);
  const WorkspaceIcon = surface === "claude_code"
    ? FolderCode
    : isCollapsed ? FolderClosed : FolderOpen;
  const toggleWorkspace = () => {
    onSelectWorkspace(workspace.id);
    onToggleWorkspaceCollapse(workspace.id, !isCollapsed);
  };

  return (
    <div
      className={`workspace-card${hasChildren ? " has-tree-children" : ""}${
        isCollapsed ? " is-collapsed" : ""
      }`}
    >
      <div
        className={`workspace-row ${isActive ? "active" : ""}`}
        role="button"
        tabIndex={0}
        onClick={toggleWorkspace}
        onContextMenu={(event) => onShowWorkspaceMenu(event, workspace.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleWorkspace();
          }
        }}
        aria-expanded={!isCollapsed}
      >
        <span className="workspace-project-icon" aria-hidden>
          <WorkspaceIcon strokeWidth={1.7} color={surface === "claude_code" ? "#b8a6ff" : undefined} />
        </span>
        <div className="workspace-copy">
          <div className="workspace-name-row">
            <div className="workspace-title">
              <span className="workspace-name">{workspaceName ?? workspace.name}</span>
            </div>
          </div>
          {summary && <div className="workspace-summary">{summary}</div>}
        </div>
        <div className="workspace-actions">
          <button
            className="ghost workspace-add"
            onClick={(event) => {
              event.stopPropagation();
              onAddAgent(workspace);
            }}
            data-tauri-drag-region="false"
            aria-label={surface === "claude_code" ? "Add Claude Code conversation" : "Add Codex conversation"}
          >
            <SquarePen strokeWidth={1.7} aria-hidden />
          </button>
        </div>
      </div>
      <div
        className={`workspace-card-content${contentCollapsedClass}`}
        aria-hidden={isCollapsed}
        inert={isCollapsed ? true : undefined}
      >
        <div className="workspace-card-content-inner">{children}</div>
      </div>
    </div>
  );
}
