import { useMemo } from "react";
import type {
  AccountSnapshot,
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  RateLimitSnapshot,
  WorkspaceSettings,
  WorkspaceInfo,
} from "@/types";
import type { UpdateState } from "@/features/update/hooks/useUpdater";
import { getUsageLabels } from "@/features/app/utils/usageLabels";
import { isMacPlatform } from "@utils/platformPaths";
import { useSettingsOpenAppDrafts } from "./useSettingsOpenAppDrafts";
import { useSettingsShortcutDrafts } from "./useSettingsShortcutDrafts";
import { useSettingsCodexSection } from "./useSettingsCodexSection";
import { useSettingsDisplaySection } from "./useSettingsDisplaySection";
import { useSettingsEnvironmentsSection } from "./useSettingsEnvironmentsSection";
import { useSettingsFeaturesSection } from "./useSettingsFeaturesSection";
import { useSettingsGitSection } from "./useSettingsGitSection";
import { useSettingsAgentsSection } from "./useSettingsAgentsSection";
import { useSettingsServerSection } from "./useSettingsServerSection";
import {
  COMPOSER_PRESET_CONFIGS,
  COMPOSER_PRESET_LABELS,
} from "@settings/components/settingsViewConstants";

type GroupedWorkspaces = Array<{
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
}>;

type UseSettingsViewOrchestrationArgs = {
  activeWorkspaceName: string | null;
  accountInfo: AccountSnapshot | null;
  accountSwitching: boolean;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  groupedWorkspaces: GroupedWorkspaces;
  reduceTransparency: boolean;
  onToggleTransparency: (value: boolean) => void;
  appSettings: AppSettings;
  accountRateLimits: RateLimitSnapshot | null;
  openAppIconById: Record<string, string>;
  onPluginsChanged?: () => void | Promise<void>;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onRunDoctor: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexDoctorResult>;
  onRunCodexUpdate?: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexUpdateResult>;
  onUpdateWorkspaceSettings: (
    id: string,
    settings: Partial<WorkspaceSettings>,
  ) => Promise<void>;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  onTestNotificationSound: () => void;
  onTestSystemNotification: () => void;
  onMobileConnectSuccess?: () => Promise<void> | void;
  onCheckForUpdates?: () => void | Promise<void>;
  updateState?: UpdateState;
  updatesEnabled?: boolean;
  isCheckingForUpdates?: boolean;
};

export function useSettingsViewOrchestration({
  activeWorkspaceName,
  accountInfo,
  accountSwitching,
  onSwitchAccount,
  onCancelSwitchAccount,
  groupedWorkspaces,
  reduceTransparency,
  onToggleTransparency,
  appSettings,
  accountRateLimits,
  openAppIconById,
  onPluginsChanged,
  onUpdateAppSettings,
  onRunDoctor,
  onRunCodexUpdate,
  onUpdateWorkspaceSettings,
  scaleShortcutTitle,
  scaleShortcutText,
  onTestNotificationSound,
  onTestSystemNotification,
  onMobileConnectSuccess,
  onCheckForUpdates,
  updateState,
  updatesEnabled,
  isCheckingForUpdates,
}: UseSettingsViewOrchestrationArgs) {
  const projects = useMemo(
    () => groupedWorkspaces.flatMap((group) => group.workspaces),
    [groupedWorkspaces],
  );
  const mainWorkspaces = useMemo(
    () => projects.filter((workspace) => (workspace.kind ?? "main") !== "worktree"),
    [projects],
  );
  const featureWorkspaceId = useMemo(
    () => projects.find((workspace) => workspace.connected)?.id ?? null,
    [projects],
  );

  const optionKeyLabel = isMacPlatform() ? "Option" : "Alt";

  const usageLabels = useMemo(
    () => getUsageLabels(accountRateLimits, appSettings.usageShowRemaining),
    [accountRateLimits, appSettings.usageShowRemaining],
  );

  const {
    openAppDrafts,
    openAppSelectedId,
    handleOpenAppDraftChange,
    handleOpenAppKindChange,
    handleCommitOpenAppsDrafts,
    handleMoveOpenApp,
    handleDeleteOpenApp,
    handleAddOpenApp,
    handleSelectOpenAppDefault,
  } = useSettingsOpenAppDrafts({
    appSettings,
    onUpdateAppSettings,
  });

  const { shortcutDrafts, handleShortcutKeyDown, clearShortcut } =
    useSettingsShortcutDrafts({
      appSettings,
      onUpdateAppSettings,
    });

  const environmentsSectionProps = useSettingsEnvironmentsSection({
    appSettings,
    onUpdateAppSettings,
    mainWorkspaces,
    onUpdateWorkspaceSettings,
  });

  const displaySectionProps = useSettingsDisplaySection({
    appSettings,
    reduceTransparency,
    onToggleTransparency,
    onUpdateAppSettings,
    scaleShortcutTitle,
    scaleShortcutText,
    onTestNotificationSound,
    onTestSystemNotification,
  });

  const serverSectionProps = useSettingsServerSection({
    appSettings,
    onUpdateAppSettings,
    onMobileConnectSuccess,
  });

  const codexSectionProps = useSettingsCodexSection({
    appSettings,
    onUpdateAppSettings,
    onPluginsChanged,
    onRunDoctor,
    onRunCodexUpdate,
  });

  const gitSectionProps = useSettingsGitSection({
    appSettings,
    onUpdateAppSettings,
    models: [],
  });

  const featuresSectionProps = useSettingsFeaturesSection({
    appSettings,
    featureWorkspaceId,
    onUpdateAppSettings,
  });

  const agentsSectionProps = useSettingsAgentsSection({
    projects,
    // Codex settings props
    appSettings,
    onUpdateAppSettings,
    globalAgentsMeta: codexSectionProps.globalAgentsMeta,
    globalAgentsPath: codexSectionProps.globalAgentsPath,
    globalAgentsError: codexSectionProps.globalAgentsError,
    globalAgentsContent: codexSectionProps.globalAgentsContent,
    globalAgentsLoading: codexSectionProps.globalAgentsLoading,
    globalAgentsRefreshDisabled: codexSectionProps.globalAgentsRefreshDisabled,
    globalAgentsSaveDisabled: codexSectionProps.globalAgentsSaveDisabled,
    globalAgentsSaveLabel: codexSectionProps.globalAgentsSaveLabel,
    globalConfigMeta: codexSectionProps.globalConfigMeta,
    globalConfigPath: codexSectionProps.globalConfigPath,
    globalConfigError: codexSectionProps.globalConfigError,
    globalConfigContent: codexSectionProps.globalConfigContent,
    globalConfigLoading: codexSectionProps.globalConfigLoading,
    globalConfigRefreshDisabled: codexSectionProps.globalConfigRefreshDisabled,
    globalConfigSaveDisabled: codexSectionProps.globalConfigSaveDisabled,
    globalConfigSaveLabel: codexSectionProps.globalConfigSaveLabel,
    onSetGlobalAgentsContent: codexSectionProps.onSetGlobalAgentsContent,
    onSetGlobalConfigContent: codexSectionProps.onSetGlobalConfigContent,
    onRefreshGlobalAgents: codexSectionProps.onRefreshGlobalAgents,
    onSaveGlobalAgents: codexSectionProps.onSaveGlobalAgents,
    onRefreshGlobalConfig: codexSectionProps.onRefreshGlobalConfig,
    onSaveGlobalConfig: codexSectionProps.onSaveGlobalConfig,
  });

  return {
    accountSectionProps: {
      activeWorkspaceName,
      accountInfo,
      accountRateLimits,
      accountSwitching,
      canSwitchAccount: Boolean(activeWorkspaceName),
      onSwitchAccount: () => {
        void onSwitchAccount();
      },
      onCancelSwitchAccount: () => {
        void onCancelSwitchAccount();
      },
      sessionPercent: usageLabels.sessionPercent,
      weeklyPercent: usageLabels.weeklyPercent,
      sessionResetLabel: usageLabels.sessionResetLabel,
      weeklyResetLabel: usageLabels.weeklyResetLabel,
      creditsLabel: usageLabels.creditsLabel,
      showWeekly: usageLabels.showWeekly,
    },
    aboutSectionProps: {
      appSettings,
      onCheckForUpdates,
      updateState,
      updatesEnabled,
      isCheckingForUpdates,
    },
    environmentsSectionProps,
    displaySectionProps,
    composerSectionProps: {
      appSettings,
      optionKeyLabel,
      composerPresetLabels: COMPOSER_PRESET_LABELS,
      onComposerPresetChange: (
        preset: AppSettings["composerEditorPreset"],
      ) => {
        const config = COMPOSER_PRESET_CONFIGS[preset];
        void onUpdateAppSettings({
          ...appSettings,
          composerEditorPreset: preset,
          ...config,
        });
      },
      onUpdateAppSettings,
    },
    shortcutsSectionProps: {
      shortcutDrafts,
      onShortcutKeyDown: handleShortcutKeyDown,
      onClearShortcut: clearShortcut,
    },
    openAppsSectionProps: {
      openAppDrafts,
      openAppSelectedId,
      openAppIconById,
      onOpenAppDraftChange: handleOpenAppDraftChange,
      onOpenAppKindChange: handleOpenAppKindChange,
      onCommitOpenApps: handleCommitOpenAppsDrafts,
      onMoveOpenApp: handleMoveOpenApp,
      onDeleteOpenApp: handleDeleteOpenApp,
      onAddOpenApp: handleAddOpenApp,
      onSelectOpenAppDefault: handleSelectOpenAppDefault,
    },
    gitSectionProps,
    serverSectionProps,
    agentsSectionProps,
    codexSectionProps,
    featuresSectionProps,
  };
}

export type SettingsViewOrchestration = ReturnType<typeof useSettingsViewOrchestration>;
