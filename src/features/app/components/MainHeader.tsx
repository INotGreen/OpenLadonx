import type { BranchInfo, OpenAppTarget, WorkspaceInfo } from "../../../types";
import type { ReactNode } from "react";
import { LaunchScriptEntryButton } from "./LaunchScriptEntryButton";
import type { WorkspaceLaunchScriptsState } from "../hooks/useWorkspaceLaunchScripts";

type MainHeaderProps = {
  workspace: WorkspaceInfo;
  parentName?: string | null;
  worktreeLabel?: string | null;
  disableBranchMenu?: boolean;
  parentPath?: string | null;
  worktreePath?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  branchName: string;
  branches: BranchInfo[];
  onCheckoutBranch: (name: string) => Promise<void> | void;
  onCreateBranch: (name: string) => Promise<void> | void;
  showWorkspaceTools?: boolean;
  extraActionsNode?: ReactNode;
  launchScriptsState?: WorkspaceLaunchScriptsState;
  worktreeRename?: {
    name: string;
    error: string | null;
    notice: string | null;
    isSubmitting: boolean;
    isDirty: boolean;
    upstream?: {
      oldBranch: string;
      newBranch: string;
      error: string | null;
      isSubmitting: boolean;
      onConfirm: () => void;
    } | null;
    onFocus: () => void;
    onChange: (value: string) => void;
    onCancel: () => void;
    onCommit: () => void;
  };
};

export function MainHeader({
  showWorkspaceTools = true,
  extraActionsNode,
  launchScriptsState,
}: MainHeaderProps) {
  return (
    <header className="main-header" data-tauri-drag-region>
      <div className="main-header-actions">
        {showWorkspaceTools && launchScriptsState?.launchScripts.length ? (
          <div className="launch-script-cluster">
            {launchScriptsState.launchScripts.map((entry) => (
              <LaunchScriptEntryButton
                key={entry.id}
                entry={entry}
                editorOpen={launchScriptsState.editorOpenId === entry.id}
                draftScript={launchScriptsState.draftScript}
                draftIcon={launchScriptsState.draftIcon}
                draftLabel={launchScriptsState.draftLabel}
                isSaving={launchScriptsState.isSaving}
                error={launchScriptsState.errorById[entry.id] ?? null}
                onRun={() => launchScriptsState.onRunScript(entry.id)}
                onOpenEditor={() => launchScriptsState.onOpenEditor(entry.id)}
                onCloseEditor={launchScriptsState.onCloseEditor}
                onDraftChange={launchScriptsState.onDraftScriptChange}
                onDraftIconChange={launchScriptsState.onDraftIconChange}
                onDraftLabelChange={launchScriptsState.onDraftLabelChange}
                onSave={launchScriptsState.onSaveScript}
                onDelete={launchScriptsState.onDeleteScript}
              />
            ))}
          </div>
        ) : null}
        {extraActionsNode}
      </div>
    </header>
  );
}
