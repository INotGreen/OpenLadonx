import { useI18nSafe } from "@/hooks/useI18nSafe";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import GitBranchPlus from "lucide-react/dist/esm/icons/git-branch-plus";

type HomeActionsProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
};

export function HomeActions({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
}: HomeActionsProps) {
  const { t } = useI18nSafe();

  return (
    <div className="home-actions">
      <button
        type="button"
        className="home-button primary home-add-workspaces-button"
        onClick={onAddWorkspace}
        data-tauri-drag-region="false"
        aria-label={String(t("home.actions.addWorkspaces"))}
      >
        <span className="home-icon" aria-hidden>
          <FolderPlus size={18} strokeWidth={1.8} />
        </span>
        <span>{String(t("home.actions.addWorkspaces"))}</span>
      </button>
      <button
        type="button"
        className="home-button secondary home-add-workspace-from-url-button"
        onClick={onAddWorkspaceFromUrl}
        data-tauri-drag-region="false"
        aria-label={String(t("home.actions.addWorkspaceFromUrl"))}
      >
        <span className="home-icon" aria-hidden>
          <GitBranchPlus size={18} strokeWidth={1.8} />
        </span>
        <span>{String(t("home.actions.addWorkspaceFromUrl"))}</span>
      </button>
    </div>
  );
}
