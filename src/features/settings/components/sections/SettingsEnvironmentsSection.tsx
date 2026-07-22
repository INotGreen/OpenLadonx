import type { Dispatch, SetStateAction } from "react";
import type { EnvInstallTarget, EnvPackageStatus, EnvRuntimeStatus, WorkspaceInfo } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import { pushErrorToast } from "@services/toasts";

type SettingsEnvironmentsSectionProps = {
  mainWorkspaces: WorkspaceInfo[];
  environmentWorkspace: WorkspaceInfo | null;
  environmentSaving: boolean;
  environmentError: string | null;
  environmentDraftScript: string;
  environmentSavedScript: string | null;
  environmentDirty: boolean;
  globalWorktreesFolderDraft: string;
  globalWorktreesFolderSaved: string | null;
  globalWorktreesFolderDirty: boolean;
  worktreesFolderDraft: string;
  worktreesFolderSaved: string | null;
  worktreesFolderDirty: boolean;
  envRuntimeStatus: EnvRuntimeStatus | null;
  envRuntimeLoading: boolean;
  envInstallBusy: boolean;
  onSetEnvironmentWorkspaceId: Dispatch<SetStateAction<string | null>>;
  onSetEnvironmentDraftScript: Dispatch<SetStateAction<string>>;
  onSetGlobalWorktreesFolderDraft: Dispatch<SetStateAction<string>>;
  onSetWorktreesFolderDraft: Dispatch<SetStateAction<string>>;
  onSaveEnvironmentSetup: () => Promise<void>;
  onRefreshEnvRuntimeStatus: () => Promise<void>;
  onInstallEnvTarget: (target: EnvInstallTarget) => Promise<void>;
};

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function EnvironmentInstallCard({
  title,
  target,
  packageStatus,
  runtimeStatus,
  busy,
  onInstall,
  actionLabel,
}: {
  title: string;
  target: EnvInstallTarget;
  packageStatus: EnvPackageStatus;
  runtimeStatus: EnvRuntimeStatus | null;
  busy: boolean;
  onInstall: (target: EnvInstallTarget) => Promise<void>;
  actionLabel: string;
}) {
  const activeInstall = runtimeStatus?.install.target === target ? runtimeStatus.install : null;
  const progressPercent =
    activeInstall?.progressPercent ??
    (activeInstall?.totalBytes
      ? (activeInstall.downloadedBytes / Math.max(activeInstall.totalBytes, 1)) * 100
      : null);
  const isActive = activeInstall != null && ["pending_elevation", "downloading", "installing"].includes(activeInstall.state);

  return (
    <div className="settings-env-card">
      <div className="settings-env-card-header">
        <div>
          <div className="settings-field-label">{title}</div>
          <div className={`settings-env-badge${packageStatus.installed ? " is-installed" : ""}`}>
            {packageStatus.installed ? "Installed" : "Not installed"}
          </div>
        </div>
        <button
          type="button"
          className="primary settings-button-compact"
          onClick={() => {
            void onInstall(target).catch((error) => {
              pushErrorToast({
                title: `${title} install failed`,
                message: error instanceof Error ? error.message : String(error),
              });
            });
          }}
          disabled={busy && !isActive}
        >
          {isActive ? "Installing..." : actionLabel}
        </button>
      </div>
      <div className="settings-help">
        {packageStatus.version ? `Version ${packageStatus.version}` : "Managed by LadonX in the app folder."}
      </div>
      {packageStatus.command ? (
        <div className="settings-env-path">{packageStatus.command}</div>
      ) : null}
      {isActive ? (
        <div className="settings-download-progress">
          <div className="settings-download-bar">
            <div
              className="settings-download-fill"
              style={{ width: `${Math.max(6, Math.min(progressPercent ?? 12, 100))}%` }}
            />
          </div>
          <div className="settings-download-meta">
            {activeInstall?.message ?? "Installing..."}
            {activeInstall?.state === "downloading"
              ? ` (${formatBytes(activeInstall.downloadedBytes)} / ${formatBytes(activeInstall.totalBytes)})`
              : progressPercent != null
                ? ` (${Math.round(progressPercent)}%)`
                : ""}
          </div>
        </div>
      ) : null}
      {!isActive && runtimeStatus?.install.target === target && runtimeStatus.install.error ? (
        <div className="settings-agents-error">{runtimeStatus.install.error}</div>
      ) : null}
    </div>
  );
}

export function SettingsEnvironmentsSection({
  mainWorkspaces,
  environmentWorkspace,
  environmentSaving,
  environmentError,
  environmentDraftScript,
  environmentSavedScript,
  environmentDirty,
  globalWorktreesFolderDraft,
  globalWorktreesFolderSaved: _globalWorktreesFolderSaved,
  globalWorktreesFolderDirty,
  worktreesFolderDraft,
  worktreesFolderSaved: _worktreesFolderSaved,
  worktreesFolderDirty,
  envRuntimeStatus,
  envRuntimeLoading,
  envInstallBusy,
  onSetEnvironmentWorkspaceId,
  onSetEnvironmentDraftScript,
  onSetGlobalWorktreesFolderDraft,
  onSetWorktreesFolderDraft,
  onSaveEnvironmentSetup,
  onRefreshEnvRuntimeStatus,
  onInstallEnvTarget,
}: SettingsEnvironmentsSectionProps) {
  const { t } = useI18nSafe();
  const hasAnyChanges =
    environmentDirty || globalWorktreesFolderDirty || worktreesFolderDirty;
  const hasProjects = mainWorkspaces.length > 0;

  return (
    <SettingsSection
      title={String(t("settings.sections.environments"))}
      subtitle={String(t("settings.environmentsDescription"))}
    >
      <div className="settings-field">
        <div className="settings-field-label">{String(t("settings.envManagerTitle"))}</div>
        <div className="settings-help">{String(t("settings.envManagerHelp"))}</div>
        <div className="settings-field-actions">
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={() => {
              void onRefreshEnvRuntimeStatus().catch((error) => {
                pushErrorToast({
                  title: "Refresh failed",
                  message: error instanceof Error ? error.message : String(error),
                });
              });
            }}
            disabled={envRuntimeLoading}
          >
            {envRuntimeLoading ? String(t("common.loading")) : String(t("common.refresh"))}
          </button>
        </div>
        {envRuntimeStatus ? (
          <>
            <div className="settings-help">
              {String(t("settings.envJsonLocation"))}: {envRuntimeStatus.envJsonPath}
            </div>
            {!envRuntimeStatus.supported ? (
              <div className="settings-help settings-help-error">
                {String(t("settings.envInstallUnsupported"))}
              </div>
            ) : null}
            <div className="settings-env-grid">
              <EnvironmentInstallCard
                title="Node.js"
                target="nodejs"
                packageStatus={envRuntimeStatus.manifest.nodejs}
                runtimeStatus={envRuntimeStatus}
                busy={envInstallBusy}
                onInstall={onInstallEnvTarget}
                actionLabel={String(t("settings.installNodejs"))}
              />
              <EnvironmentInstallCard
                title="Codex CLI"
                target="codex"
                packageStatus={envRuntimeStatus.manifest.codex}
                runtimeStatus={envRuntimeStatus}
                busy={envInstallBusy || !envRuntimeStatus.manifest.nodejs.installed}
                onInstall={onInstallEnvTarget}
                actionLabel={String(t("settings.installCodex"))}
              />
              <EnvironmentInstallCard
                title="Claude Code"
                target="claude_code"
                packageStatus={envRuntimeStatus.manifest.claudeCode}
                runtimeStatus={envRuntimeStatus}
                busy={envInstallBusy || !envRuntimeStatus.manifest.nodejs.installed}
                onInstall={onInstallEnvTarget}
                actionLabel={String(t("settings.installClaudeCode"))}
              />
            </div>
          </>
        ) : (
          <div className="settings-help">{String(t("common.loading"))}</div>
        )}
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="settings-global-worktrees-folder">
          {String(t("settings.globalWorktreesRoot"))}
        </label>
        <div className="settings-help">
          {String(t("settings.globalWorktreesRootHelp"))}
        </div>
        <div className="settings-field-row">
          <input
            id="settings-global-worktrees-folder"
            type="text"
            className="settings-input"
            value={globalWorktreesFolderDraft}
            onChange={(event) => onSetGlobalWorktreesFolderDraft(event.target.value)}
            placeholder="/path/to/worktrees-root"
            disabled={environmentSaving}
          />
          <button
            type="button"
            className="ghost settings-button-compact"
            onClick={async () => {
              try {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const selected = await open({
                  directory: true,
                  multiple: false,
                  title: String(t("settings.selectGlobalWorktreesRoot")),
                });
                if (selected && typeof selected === "string") {
                  onSetGlobalWorktreesFolderDraft(selected);
                }
              } catch (error) {
                pushErrorToast({
                  title: String(t("settings.failedToOpenFolderPicker")),
                  message: error instanceof Error ? error.message : String(error),
                });
              }
            }}
            disabled={environmentSaving}
          >
            {String(t("common.browse"))}
          </button>
        </div>
        {!hasProjects ? (
          <div className="settings-field-actions">
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => onSetGlobalWorktreesFolderDraft(_globalWorktreesFolderSaved ?? "")}
              disabled={environmentSaving || !globalWorktreesFolderDirty}
            >
              {String(t("common.reset"))}
            </button>
            <button
              type="button"
              className="primary settings-button-compact"
              onClick={() => {
                void onSaveEnvironmentSetup();
              }}
              disabled={environmentSaving || !globalWorktreesFolderDirty}
            >
              {environmentSaving ? String(t("status.saving")) : String(t("common.save"))}
            </button>
          </div>
        ) : null}
        {!hasProjects && environmentError ? (
          <div className="settings-agents-error">{environmentError}</div>
        ) : null}
      </div>

      {!hasProjects ? (
        <div className="settings-empty">{String(t("settings.noProjectsYet"))}</div>
      ) : (
        <>
          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-environment-project">
              {String(t("settings.project"))}
            </label>
            <select
              id="settings-environment-project"
              className="settings-select"
              value={environmentWorkspace?.id ?? ""}
              onChange={(event) => onSetEnvironmentWorkspaceId(event.target.value)}
              disabled={environmentSaving}
            >
              {mainWorkspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
            {environmentWorkspace ? (
              <div className="settings-help">{environmentWorkspace.path}</div>
            ) : null}
          </div>

          <div className="settings-field">
            <div className="settings-field-label">{String(t("settings.setupScript"))}</div>
            <div className="settings-help">
              {String(t("settings.setupScriptHelp"))}
            </div>
            {environmentError ? (
              <div className="settings-agents-error">{environmentError}</div>
            ) : null}
            <textarea
              className="settings-agents-textarea"
              value={environmentDraftScript}
              onChange={(event) => onSetEnvironmentDraftScript(event.target.value)}
              placeholder="pnpm install"
              spellCheck={false}
              disabled={environmentSaving}
            />
            <div className="settings-field-actions">
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => {
                  const clipboard = typeof navigator === "undefined" ? null : navigator.clipboard;
                  if (!clipboard?.writeText) {
                    pushErrorToast({
                      title: String(t("settings.copyFailed")),
                      message: String(t("settings.clipboardUnavailable")),
                    });
                    return;
                  }

                  void clipboard.writeText(environmentDraftScript).catch(() => {
                    pushErrorToast({
                      title: String(t("settings.copyFailed")),
                      message: String(t("settings.couldNotWriteToClipboard")),
                    });
                  });
                }}
                disabled={environmentSaving || environmentDraftScript.length === 0}
              >
                {String(t("common.copy"))}
              </button>
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={() => onSetEnvironmentDraftScript(environmentSavedScript ?? "")}
                disabled={environmentSaving || !environmentDirty}
              >
                {String(t("common.reset"))}
              </button>
              <button
                type="button"
                className="primary settings-button-compact"
                onClick={() => {
                  void onSaveEnvironmentSetup();
                }}
                disabled={environmentSaving || !hasAnyChanges}
              >
                {environmentSaving ? String(t("status.saving")) : String(t("common.save"))}
              </button>
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field-label" htmlFor="settings-worktrees-folder">
              {String(t("settings.worktreesFolder"))}
            </label>
            <div className="settings-help">
              {String(t("settings.worktreesFolderHelp"))}
            </div>
            <div className="settings-field-row">
              <input
                id="settings-worktrees-folder"
                type="text"
                className="settings-input"
                value={worktreesFolderDraft}
                onChange={(event) => onSetWorktreesFolderDraft(event.target.value)}
                placeholder="/path/to/worktrees"
                disabled={environmentSaving}
              />
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={async () => {
                  try {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const selected = await open({
                      directory: true,
                      multiple: false,
                      title: String(t("settings.selectWorktreesFolder")),
                    });
                    if (selected && typeof selected === "string") {
                      onSetWorktreesFolderDraft(selected);
                    }
                  } catch (error) {
                    pushErrorToast({
                      title: String(t("settings.failedToOpenFolderPicker")),
                      message: error instanceof Error ? error.message : String(error),
                    });
                  }
                }}
                disabled={environmentSaving}
              >
                {String(t("common.browse"))}
              </button>
            </div>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
