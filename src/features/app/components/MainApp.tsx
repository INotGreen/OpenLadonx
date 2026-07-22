import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import i18n from "@/i18n";
import successSoundUrl from "@/assets/success-notification.mp3";
import errorSoundUrl from "@/assets/error-notification.mp3";
import { AuthGate } from "@app/components/AuthGate";
import { MainAppShell } from "@app/components/MainAppShell";
import {
  syncLadonxAuthEnv,
} from "@/services/tauri";
import { useThreads } from "@threads/hooks/useThreads";
import { usePullRequestComposer } from "@/features/git/hooks/usePullRequestComposer";
import { useAutoExitEmptyDiff } from "@/features/git/hooks/useAutoExitEmptyDiff";
import { isMissingRepo } from "@/features/git/utils/repoErrors";
import { useModels } from "@/features/models/hooks/useModels";
import { buildCustomModelOptions } from "@/features/models/utils/customModels";
import { useCollaborationModes } from "@/features/collaboration/hooks/useCollaborationModes";
import { useCollaborationModeSelection } from "@/features/collaboration/hooks/useCollaborationModeSelection";
import { useSkills } from "@/features/skills/hooks/useSkills";
import { AutomationView } from "@app/components/AutomationView";
import { SkillsStoreView } from "@app/components/SkillsStoreView";
import { useApps } from "@/features/apps/hooks/useApps";
import { useConfiguredPlugins } from "@/features/apps/hooks/useConfiguredPlugins";
import { usePluginsMarketplace } from "@/features/apps/hooks/usePluginsMarketplace";
import { useCustomPrompts } from "@/features/prompts/hooks/useCustomPrompts";
import { useBranchSwitcherShortcut } from "@/features/git/hooks/useBranchSwitcherShortcut";
import { useRenameWorktreePrompt } from "@/features/workspaces/hooks/useRenameWorktreePrompt";
import { useLayoutController } from "@app/hooks/useLayoutController";
import { useNotificationController } from "@app/hooks/useNotificationController";
import { useResponseRequiredNotificationsController } from "@app/hooks/useResponseRequiredNotificationsController";
import { useErrorToasts } from "@/features/notifications/hooks/useErrorToasts";
import { useSuccessToasts } from "@/features/notifications/hooks/useSuccessToasts";
import { useComposerShortcuts } from "@/features/composer/hooks/useComposerShortcuts";
import { useComposerMenuActions } from "@/features/composer/hooks/useComposerMenuActions";
import { useMainAppComposerWorkspaceState } from "@app/hooks/useMainAppComposerWorkspaceState";
import { useMainAppGitState } from "@app/hooks/useMainAppGitState";
import { useMainAppLayoutSurfaces } from "@app/hooks/useMainAppLayoutSurfaces";
import { useMainAppLayoutNodes } from "@app/hooks/useMainAppLayoutNodes";
import { useWorkspaceFromUrlPrompt } from "@/features/workspaces/hooks/useWorkspaceFromUrlPrompt";
import { useWorkspaceController } from "@app/hooks/useWorkspaceController";
import { useWorkspaceSelection } from "@/features/workspaces/hooks/useWorkspaceSelection";
import { usePlanReadyActions } from "@app/hooks/usePlanReadyActions";
import { useThreadRows } from "@app/hooks/useThreadRows";
import { useInterruptShortcut } from "@app/hooks/useInterruptShortcut";
import { useArchiveShortcut } from "@app/hooks/useArchiveShortcut";
import { useTerminalController } from "@/features/terminal/hooks/useTerminalController";
import { useWorkspaceLaunchScripts } from "@app/hooks/useWorkspaceLaunchScripts";
import { useWorktreeSetupScript } from "@app/hooks/useWorktreeSetupScript";
import { effectiveCommitMessageModelId } from "@/features/git/utils/commitMessageModelSelection";
import { useMobileServerSetup } from "@/features/mobile/hooks/useMobileServerSetup";
import { useMainAppModals } from "@app/hooks/useMainAppModals";
import { useMainAppDisplayNodes } from "@app/hooks/useMainAppDisplayNodes";
import { useMainAppPromptActions } from "@app/hooks/useMainAppPromptActions";
import { useMainAppShellProps } from "@app/hooks/useMainAppShellProps";
import { useMainAppSidebarMenuOrchestration } from "@app/hooks/useMainAppSidebarMenuOrchestration";
import { useMainAppSettingsActions } from "@app/hooks/useMainAppSettingsActions";
import { useMainAppThreadCodexState } from "@app/hooks/useMainAppThreadCodexState";
import { useMainAppWorktreeState } from "@app/hooks/useMainAppWorktreeState";
import { useMainAppWorkspaceActions } from "@app/hooks/useMainAppWorkspaceActions";
import { useMainAppWorkspaceLifecycle } from "@app/hooks/useMainAppWorkspaceLifecycle";
import { useMainAppMobileThreadRefresh } from "@app/hooks/useMainAppMobileThreadRefresh";
import { useUpdater } from "@/features/update/hooks/useUpdater";
import type {
  ComposerEditorSettings,
  ServiceTier,
  WorkspaceInfo,
} from "@/types";
import { useOpenAppIcons } from "@app/hooks/useOpenAppIcons";
import { useAccountSwitching } from "@app/hooks/useAccountSwitching";
import { useNewAgentDraft } from "@app/hooks/useNewAgentDraft";
import { useSystemNotificationThreadLinks } from "@app/hooks/useSystemNotificationThreadLinks";
import { useThreadListSortKey } from "@app/hooks/useThreadListSortKey";
import { useThreadListActions } from "@app/hooks/useThreadListActions";
import { useRemoteThreadLiveConnection } from "@app/hooks/useRemoteThreadLiveConnection";
import { useTrayRecentThreads } from "@app/hooks/useTrayRecentThreads";
import { useTraySessionUsage } from "@app/hooks/useTraySessionUsage";
import { useTauriEvent } from "@app/hooks/useTauriEvent";
import { useAppBootstrapOrchestration } from "@app/bootstrap/useAppBootstrapOrchestration";
import {
  useThreadCodexBootstrapOrchestration,
  useThreadCodexSyncOrchestration,
  useThreadSelectionHandlersOrchestration,
  useThreadUiOrchestration,
} from "@app/orchestration/useThreadOrchestration";
import { useAppShellOrchestration } from "@app/orchestration/useLayoutOrchestration";
import { normalizeCodexArgsInput } from "@/utils/codexArgsInput";
import { subscribeTrayOpenThread } from "@services/events";
import { invoke } from "@tauri-apps/api/core";

const BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX = "file-preview-browser-webview";

const SettingsView = lazy(() =>
  import("@settings/components/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);

export default function MainApp() {
  const [authReady, setAuthReady] = useState(false);
  const {
    appSettings,
    setAppSettings,
    doctor,
    codexUpdate,
    appSettingsLoading,
    reduceTransparency,
    setReduceTransparency,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
    debugOpen,
    setDebugOpen,
    debugEntries,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
    shouldReduceTransparency,
    dictationState,
    handleToggleDictation,
    cancelDictation,
    dictationReady,
    dictationError,
    dictationHint,
  } = useAppBootstrapOrchestration();
  const {
    threadListSortKey,
    setThreadListSortKey,
    threadListOrganizeMode,
  } = useThreadListSortKey();
  const updater = useUpdater({
    enabled: true,
    onDebug: addDebugEntry,
  });
  const [activeTab, setActiveTab] = useState<
    "home" | "projects" | "chat" | "git" | "log"
  >("chat");
  const tabletTab =
    activeTab === "projects" || activeTab === "home" ? "chat" : activeTab;
  const {
    workspaces,
    workspaceGroups,
    groupedWorkspaces,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    addWorkspaceFromPath,
    addWorkspaceFromGitUrl,
    addWorkspacesFromPaths,
    mobileRemoteWorkspacePathPrompt,
    updateMobileRemoteWorkspacePathInput,
    appendMobileRemoteWorkspacePathFromRecent,
    cancelMobileRemoteWorkspacePathPrompt,
    submitMobileRemoteWorkspacePathPrompt,
    addCloneAgent,
    addWorktreeAgent,
    connectWorkspace,
    markWorkspaceConnected,
    updateWorkspaceSettings,
    removeWorkspace,
    removeWorktree,
    renameWorktree,
    renameWorktreeUpstream,
    deletingWorktreeIds,
    hasLoaded,
    refreshWorkspaces,
  } = useWorkspaceController({
    appSettings,
    addDebugEntry,
    queueSaveSettings,
  });
  const {
    showMobileSetupWizard,
    mobileSetupWizardProps,
    handleMobileConnectSuccess,
  } = useMobileServerSetup({
    appSettings,
    appSettingsLoading,
    queueSaveSettings,
    refreshWorkspaces,
  });
  const workspacesById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const {
    threadCodexParamsVersion,
    getThreadCodexParams,
    patchThreadCodexParams,
    accessMode,
    setAccessMode,
    preferredModelId,
    setPreferredModelId,
    preferredEffort,
    setPreferredEffort,
    preferredServiceTier,
    setPreferredServiceTier,
    preferredCollabModeId,
    setPreferredCollabModeId,
    preferredCodexArgsOverride,
    setPreferredCodexArgsOverride,
    threadCodexSelectionKey,
    setThreadCodexSelectionKey,
    activeThreadIdRef,
    pendingNewThreadSeedRef,
    persistThreadCodexParams,
  } = useThreadCodexBootstrapOrchestration({
    activeWorkspaceId,
  });
  const [terminalOpenByThread, setTerminalOpenByThread] = useState<
    Record<string, boolean>
  >({});
  const toggleTerminalForActiveThread = useCallback(() => {
    const threadId = activeThreadIdRef.current;
    if (!threadId) {
      return;
    }
    setTerminalOpenByThread((prev) => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  }, []);
  const openTerminalForThread = useCallback((threadId: string) => {
    setTerminalOpenByThread((prev) =>
      prev[threadId] ? prev : { ...prev, [threadId]: true },
    );
  }, []);
  const closeTerminalForThread = useCallback((threadId: string) => {
    setTerminalOpenByThread((prev) =>
      prev[threadId] ? { ...prev, [threadId]: false } : prev,
    );
  }, []);
  const {
    appRef,
    isResizing,
    sidebarWidth,
    chatDiffSplitPositionPercent,
    rightPanelWidth,
    rightPanelWidthPx,
    onSidebarResizeStart,
    preserveSidebarWidth,
    onChatDiffSplitPositionResizeStart,
    onRightPanelResizeStart,
    terminalPanelHeight,
    onTerminalPanelResizeStart,
    debugPanelHeight,
    onDebugPanelResizeStart,
    isCompact,
    isPhone,
    sidebarCollapsed,
    rightPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    handleDebugClick,
  } = useLayoutController({
    onToggleTerminal: toggleTerminalForActiveThread,
    setActiveTab,
    setDebugOpen,
    toggleDebugPanelShortcut: appSettings.toggleDebugPanelShortcut,
    toggleTerminalShortcut: appSettings.toggleTerminalShortcut,
  });
  const sidebarToggleProps = {
    isCompact,
    sidebarCollapsed,
    rightPanelCollapsed,
    onCollapseSidebar: collapseSidebar,
    onExpandSidebar: expandSidebar,
    onCollapseRightPanel: collapseRightPanel,
    onExpandRightPanel: expandRightPanel,
  };
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceHomeTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const getWorkspaceName = useCallback(
    (workspaceId: string) => workspacesById.get(workspaceId)?.name,
    [workspacesById],
  );

  const recordPendingThreadLinkRef = useRef<
    (workspaceId: string, threadId: string) => void
  >(() => {});

  const { errorToasts, dismissErrorToast } = useErrorToasts();
  const { successToasts, dismissSuccessToast } = useSuccessToasts();
  const queueGitStatusRefreshRef = useRef<() => void>(() => {});
  const handleThreadMessageActivity = useCallback(() => {
    queueGitStatusRefreshRef.current();
  }, []);

  // Access mode is thread-scoped (best-effort persisted) and falls back to the app default.

  // 自定义 API 模式：按 workspace source 取对应自定义配置的模型列表。
  const customModels = useMemo(() => {
    if (appSettings.apiSourceMode !== "custom") {
      return null;
    }
    const isClaudeSource = activeWorkspace?.source === "claude_code";
    const customConfig = isClaudeSource
      ? appSettings.customMessagesApi
      : appSettings.customResponseApi;
    if (!customConfig || customConfig.models.length === 0) {
      return null;
    }
    return buildCustomModelOptions(customConfig.models);
  }, [
    appSettings.apiSourceMode,
    appSettings.customMessagesApi,
    appSettings.customResponseApi,
    activeWorkspace?.source,
  ]);

  const {
    models,
    selectedModel,
    selectedModelId,
    setSelectedModelId,
    reasoningSupported,
    reasoningOptions,
    selectedEffort,
    setSelectedEffort
  } = useModels({
    activeWorkspace,
    onDebug: addDebugEntry,
    preferredModelId,
    preferredEffort,
    selectionKey: threadCodexSelectionKey,
    customModels,
  });

  const {
    collaborationModes,
    selectedCollaborationMode,
    selectedCollaborationModeId,
    setSelectedCollaborationModeId,
  } = useCollaborationModes({
    activeWorkspace,
    enabled: appSettings.collaborationModesEnabled,
    preferredModeId: preferredCollabModeId,
    selectionKey: threadCodexSelectionKey,
    onDebug: addDebugEntry,
  });

  const [selectedCodexArgsOverride, setSelectedCodexArgsOverride] = useState<string | null>(
    null,
  );
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewTabs, setPreviewTabs] = useState<string[]>([]);
  const [selectedServiceTier, setSelectedServiceTier] = useState<
    ServiceTier | null | undefined
  >(undefined);
  useEffect(() => {
    setSelectedCodexArgsOverride(normalizeCodexArgsInput(preferredCodexArgsOverride));
  }, [preferredCodexArgsOverride, threadCodexSelectionKey]);
  useEffect(() => {
    setSelectedServiceTier(preferredServiceTier);
  }, [preferredServiceTier, threadCodexSelectionKey]);
  useEffect(() => {
    void invoke("browser_preview_hide", {
      label: BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX,
    }).catch(() => {});
    void invoke("browser_preview_close_with_prefix", {
      labelPrefix: BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX,
    }).catch(() => {});
  }, []);
  useEffect(() => {
    void syncLadonxAuthEnv().catch(() => {});
  }, []);
  useEffect(() => {
    if (!rightPanelCollapsed) {
      return;
    }
    void invoke("browser_preview_hide", {
      label: BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX,
    }).catch(() => {});
    window.setTimeout(() => {
      void invoke("browser_preview_close_with_prefix", {
        labelPrefix: BROWSER_PREVIEW_WEBVIEW_LABEL_PREFIX,
      }).catch(() => {});
    }, 0);
  }, [rightPanelCollapsed]);

  // 同步语言设置到 i18n
  useEffect(() => {
    if (appSettings?.language && !appSettingsLoading) {
      i18n.changeLanguage(appSettings.language);
    }
  }, [appSettings?.language, appSettingsLoading]);

  const {
    handleSelectModel,
    handleSelectEffort,
    handleSelectServiceTier,
    handleSelectCollaborationMode,
    handleSelectAccessMode,
  } = useThreadSelectionHandlersOrchestration({
    appSettingsLoading,
    setAppSettings,
    queueSaveSettings,
    activeThreadIdRef,
    setSelectedModelId,
    setSelectedEffort,
    setSelectedServiceTier,
    setSelectedCollaborationModeId,
    setAccessMode,
    setSelectedCodexArgsOverride,
    persistThreadCodexParams,
  });
  const commitMessageModelId = useMemo(
    () => effectiveCommitMessageModelId(models, appSettings.commitMessageModelId),
    [models, appSettings.commitMessageModelId],
  );

  const composerShortcuts = {
    modelShortcut: appSettings.composerModelShortcut,
    accessShortcut: appSettings.composerAccessShortcut,
    reasoningShortcut: appSettings.composerReasoningShortcut,
    collaborationShortcut: appSettings.collaborationModesEnabled
      ? appSettings.composerCollaborationShortcut
      : null,
    models,
    collaborationModes,
    selectedModelId,
    onSelectModel: handleSelectModel,
    selectedCollaborationModeId,
    onSelectCollaborationMode: handleSelectCollaborationMode,
    accessMode,
    onSelectAccessMode: handleSelectAccessMode,
    reasoningOptions,
    selectedEffort,
    onSelectEffort: handleSelectEffort,
    selectedServiceTier: selectedServiceTier ?? null,
    reasoningSupported,
  };

  useComposerShortcuts({
    textareaRef: composerInputRef,
    ...composerShortcuts,
  });

  useComposerShortcuts({
    textareaRef: workspaceHomeTextareaRef,
    ...composerShortcuts,
  });

  useComposerMenuActions({
    models,
    selectedModelId,
    onSelectModel: handleSelectModel,
    collaborationModes,
    selectedCollaborationModeId,
    onSelectCollaborationMode: handleSelectCollaborationMode,
    accessMode,
    onSelectAccessMode: handleSelectAccessMode,
    reasoningOptions,
    selectedEffort,
    onSelectEffort: handleSelectEffort,
    reasoningSupported,
    onFocusComposer: () => composerInputRef.current?.focus(),
  });
  const { skills, refreshSkills } = useSkills({ activeWorkspace, onDebug: addDebugEntry });
  const {
    prompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    movePrompt,
    getWorkspacePromptsDir,
    getGlobalPromptsDir,
  } = useCustomPrompts({ activeWorkspace, onDebug: addDebugEntry });
  const resolvedModel = selectedModel?.model ?? null;
  const resolvedEffort = reasoningSupported ? selectedEffort : null;

  const {
    handleThreadCodexMetadataDetected,
    ensureWorkspaceRuntimeCodexArgs,
    getThreadArgsBadge,
  } = useMainAppThreadCodexState({
    appCodexArgs: appSettings.codexArgs,
    selectedCodexArgsOverride,
    getThreadCodexParams,
    patchThreadCodexParams,
  });

  const { collaborationModePayload } = useCollaborationModeSelection({
    selectedCollaborationMode,
    selectedCollaborationModeId,
    selectedEffort: resolvedEffort,
    resolvedModel,
  });

  const {
    setActiveThreadId,
    hasLocalThreadSnapshot,
    activeThreadId,
    activeItems,
    approvals,
    userInputRequests,
    threadsByWorkspace,
    threadParentById,
    isSubagentThread,
    threadStatusById,
    threadResumeLoadingById,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    activeTurnIdByThread,
    tokenUsageByThread,
    rateLimitsByWorkspace,
    accountByWorkspace,
    planByThread,
    goalByThread,
    pinnedThreadsVersion,
    interruptTurn,
    removeThread,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    renameThread,
    startThreadForWorkspace,
    listThreadsForWorkspaces,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    resetWorkspaceThreads,
    refreshThread,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startUncommittedReview,
    startResume,
    startCompact,
    startApps,
    startMcp,
    startFast,
    startStatus,
    reviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
    refreshAccountInfo,
    refreshAccountRateLimits,
  } = useThreads({
    activeWorkspace,
    onWorkspaceConnected: markWorkspaceConnected,
    onDebug: addDebugEntry,
    model: resolvedModel,
    effort: resolvedEffort,
    serviceTier: selectedServiceTier,
    collaborationMode: collaborationModePayload,
    onSelectServiceTier: handleSelectServiceTier,
    accessMode,
    ensureWorkspaceRuntimeCodexArgs,
    reviewDeliveryMode: appSettings.reviewDeliveryMode,
    steerEnabled: appSettings.steerEnabled,
    chatHistoryScrollbackItems: appSettingsLoading
      ? null
      : appSettings.chatHistoryScrollbackItems,
    customPrompts: prompts,
    onMessageActivity: handleThreadMessageActivity,
    threadSortKey: threadListSortKey,
    onThreadCodexMetadataDetected: handleThreadCodexMetadataDetected,
  });
  const terminalOpen = activeThreadId
    ? Boolean(terminalOpenByThread[activeThreadId])
    : false;
  const isTerminalPreviewActive = previewPath === "terminal:";
  const openTerminal = useCallback(() => {
    if (!activeThreadId) {
      return;
    }
    openTerminalForThread(activeThreadId);
  }, [activeThreadId, openTerminalForThread]);
  const closeTerminalPanel = useCallback(() => {
    if (!activeThreadId) {
      return;
    }
    closeTerminalForThread(activeThreadId);
  }, [activeThreadId, closeTerminalForThread]);
  const [skillsStoreOpen, setSkillsStoreOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const skillsStoreAnchorRef = useRef<{
    workspaceId: string | null;
    threadId: string | null;
  } | null>(null);
  const automationAnchorRef = useRef<{
    workspaceId: string | null;
    threadId: string | null;
  } | null>(null);
  const openSkillsStore = useCallback(() => {
    skillsStoreAnchorRef.current = {
      workspaceId: activeWorkspaceId,
      threadId: activeThreadId,
    };
    setActiveTab("chat");
    setSkillsStoreOpen(true);
    setAutomationOpen(false);
  }, [activeThreadId, activeWorkspaceId]);
  const openAutomation = useCallback(() => {
    automationAnchorRef.current = {
      workspaceId: activeWorkspaceId,
      threadId: activeThreadId,
    };
    setActiveTab("chat");
    setSkillsStoreOpen(false);
    skillsStoreAnchorRef.current = null;
    setAutomationOpen(true);
  }, [activeThreadId, activeWorkspaceId]);
  const closeOverlays = useCallback(() => {
    setSkillsStoreOpen(false);
    setAutomationOpen(false);
    skillsStoreAnchorRef.current = null;
    automationAnchorRef.current = null;
  }, []);
  useEffect(() => {
    if (activeTab !== "chat") {
      setSkillsStoreOpen(false);
      setAutomationOpen(false);
      skillsStoreAnchorRef.current = null;
      automationAnchorRef.current = null;
    }
  }, [activeTab]);
  useEffect(() => {
    if (!automationOpen) {
      return;
    }
    const anchor = automationAnchorRef.current;
    if (!anchor) {
      return;
    }
    if (anchor.workspaceId !== activeWorkspaceId || anchor.threadId !== activeThreadId) {
      setAutomationOpen(false);
      automationAnchorRef.current = null;
    }
  }, [activeThreadId, activeWorkspaceId, automationOpen]);
  useEffect(() => {
    if (!skillsStoreOpen) {
      return;
    }
    const anchor = skillsStoreAnchorRef.current;
    if (!anchor) {
      return;
    }
    if (anchor.workspaceId !== activeWorkspaceId || anchor.threadId !== activeThreadId) {
      setSkillsStoreOpen(false);
      skillsStoreAnchorRef.current = null;
    }
  }, [activeThreadId, activeWorkspaceId, skillsStoreOpen]);
  const { connectionState: remoteThreadConnectionState, reconnectLive } =
    useRemoteThreadLiveConnection({
      backendMode: appSettings.backendMode,
      activeWorkspace,
      activeThreadId,
      activeThreadHasLocalSnapshot: hasLocalThreadSnapshot(activeThreadId),
      activeThreadIsProcessing: Boolean(
        activeThreadId && threadStatusById[activeThreadId]?.isProcessing,
      ),
      refreshThread,
      reconnectWorkspace: connectWorkspace,
    });

  const { mobileThreadRefreshLoading, handleMobileThreadRefresh } =
    useMainAppMobileThreadRefresh({
      activeWorkspace,
      activeThreadId,
      startThreadForWorkspace,
      refreshThread,
      reconnectLive,
    });
  const {
    handleTestNotificationSound,
    handleTestSystemNotification,
  } = useNotificationController({
    notificationSoundsEnabled: appSettings.notificationSoundsEnabled,
    systemNotificationsEnabled: appSettings.systemNotificationsEnabled,
    subagentSystemNotificationsEnabled:
      appSettings.subagentSystemNotificationsEnabled,
    isSubagentThread,
    getWorkspaceName,
    onThreadNotificationSent: (workspaceId, threadId) =>
      recordPendingThreadLinkRef.current(workspaceId, threadId),
    onDebug: addDebugEntry,
    successSoundUrl,
    errorSoundUrl,
  });
  const gitState = useMainAppGitState({
    activeWorkspace,
    activeWorkspaceId,
    activeItems,
    activeThreadId,
    activeTab,
    tabletTab,
    isCompact,
    isTablet: false,
    setActiveTab,
    appSettings: {
      preloadGitDiffs: appSettings.preloadGitDiffs,
      gitDiffIgnoreWhitespaceChanges: appSettings.gitDiffIgnoreWhitespaceChanges,
      splitChatDiffView: appSettings.splitChatDiffView,
      reviewDeliveryMode: appSettings.reviewDeliveryMode,
    },
    addDebugEntry,
    updateWorkspaceSettings,
    commitMessageModelId,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessageToThread,
  });
  const {
    activeWorkspaceRef,
    activeWorkspaceIdRef,
    queueGitStatusRefresh,
    alertError,
    centerMode,
    setCenterMode,
    setSelectedDiffPath,
    gitPanelMode,
    setGitPanelMode,
    gitDiffViewStyle,
    setGitDiffViewStyle,
    selectedPullRequest,
    setSelectedPullRequest,
    selectedCommitSha,
    diffSource,
    setDiffSource,
    gitStatus,
    gitLogEntries,
    gitLogAheadEntries,
    gitLogBehindEntries,
    shouldLoadDiffs,
    activeDiffs,
    activeDiffLoading,
    activeDiffError,
    shouldLoadGitHubPanelData,
    handleGitIssuesChange,
    handleGitPullRequestsChange,
    handleGitPullRequestDiffsChange,
    handleGitPullRequestCommentsChange,
    refreshGitRemote,
    branches,
    currentBranch,
    isBranchSwitcherEnabled,
    handleCheckoutBranch,
    handleCreateGitHubRepo,
    createGitHubRepoLoading,
    handleInitGitRepo,
    initGitRepoLoading,
    isLaunchingPullRequestReview,
    pullRequestReviewActions,
    runPullRequestReview,
  } = gitState;
  const handlePreviewFile = useCallback(
    (path: string, kind: "file" | "folder" = "file") => {
      const previewTarget = kind === "folder" ? `tree:${path}` : path;
      setPreviewTabs((current) =>
        current.includes(previewTarget) ? current : [...current, previewTarget],
      );
      setPreviewPath(previewTarget);
      gitState.setFilePanelMode("preview");
      if (isPhone) {
        setActiveTab("log");
      }
      if (!isPhone && !sidebarCollapsed) {
        const sidebarElement = appRef.current?.querySelector(".sidebar");
        const measuredWidth =
          sidebarElement instanceof HTMLElement
            ? sidebarElement.getBoundingClientRect().width
            : null;
        preserveSidebarWidth(measuredWidth);
      }
      if (rightPanelCollapsed) {
        expandRightPanel();
      }
    },
    [
      appRef,
      expandRightPanel,
      gitState,
      isPhone,
      preserveSidebarWidth,
      rightPanelCollapsed,
      setActiveTab,
      sidebarCollapsed,
    ],
  );
  const handlePreviewPathChange = useCallback((path: string | null) => {
    if (path) {
      setPreviewTabs((current) =>
        current.includes(path) ? current : [...current, path],
      );
    }
    setPreviewPath(path);
  }, []);
  const handlePreviewTabClose = useCallback((path: string) => {
    setPreviewTabs((current) => {
      const next = current.filter((entry) => entry !== path);
      setPreviewPath((active) => {
        if (active !== path) {
          return active;
        }
        const closedIndex = current.indexOf(path);
        return next[closedIndex] ?? next[closedIndex - 1] ?? null;
      });
      return next;
    });
  }, []);
  queueGitStatusRefreshRef.current = queueGitStatusRefresh;
  const composerEditorSettings = useMemo<ComposerEditorSettings>(
    () => ({
      preset: appSettings.composerEditorPreset,
      expandFenceOnSpace: appSettings.composerFenceExpandOnSpace,
      expandFenceOnEnter: appSettings.composerFenceExpandOnEnter,
      fenceLanguageTags: appSettings.composerFenceLanguageTags,
      fenceWrapSelection: appSettings.composerFenceWrapSelection,
      autoWrapPasteMultiline: appSettings.composerFenceAutoWrapPasteMultiline,
      autoWrapPasteCodeLike: appSettings.composerFenceAutoWrapPasteCodeLike,
      continueListOnShiftEnter: appSettings.composerListContinuation,
    }),
    [
      appSettings.composerEditorPreset,
      appSettings.composerFenceExpandOnSpace,
      appSettings.composerFenceExpandOnEnter,
      appSettings.composerFenceLanguageTags,
      appSettings.composerFenceWrapSelection,
      appSettings.composerFenceAutoWrapPasteMultiline,
      appSettings.composerFenceAutoWrapPasteCodeLike,
      appSettings.composerListContinuation,
    ],
  );

  const { apps } = useApps({
    activeWorkspace,
    activeThreadId,
    enabled: appSettings.experimentalAppsEnabled,
    onDebug: addDebugEntry,
  });
  const { plugins: configuredPlugins, refreshPlugins: refreshConfiguredPlugins } =
    useConfiguredPlugins();

  const { plugins: marketPlugins, isLoading: marketPluginsLoading, refreshPlugins: refreshMarketPlugins } =
    usePluginsMarketplace();

  useThreadCodexSyncOrchestration({
    activeWorkspaceId,
    activeThreadId,
    appSettings: {
      defaultAccessMode: appSettings.defaultAccessMode,
      lastComposerModelId: appSettings.lastComposerModelId,
      lastComposerReasoningEffort: appSettings.lastComposerReasoningEffort,
    },
    threadCodexParamsVersion,
    getThreadCodexParams,
    patchThreadCodexParams,
    setThreadCodexSelectionKey,
    setAccessMode,
    setPreferredModelId,
    setPreferredEffort,
    setPreferredServiceTier,
    setPreferredCollabModeId,
    setPreferredCodexArgsOverride,
    activeThreadIdRef,
    pendingNewThreadSeedRef,
    selectedModelId,
    resolvedEffort,
    selectedServiceTier,
    accessMode,
    selectedCollaborationModeId,
    selectedCodexArgsOverride,
  });

  useThreadListActions({
    threadListSortKey,
    setThreadListSortKey,
    workspaces,
    refreshWorkspaces,
    listThreadsForWorkspaces,
    resetWorkspaceThreads,
  });

  useResponseRequiredNotificationsController({
    systemNotificationsEnabled: appSettings.systemNotificationsEnabled,
    subagentSystemNotificationsEnabled:
      appSettings.subagentSystemNotificationsEnabled,
    isSubagentThread,
    approvals,
    userInputRequests,
    getWorkspaceName,
    onDebug: addDebugEntry,
  });

  const {
    activeAccount,
    accountSwitching,
    handleSwitchAccount,
    handleCancelSwitchAccount,
  } = useAccountSwitching({
    activeWorkspaceId,
    accountByWorkspace,
    refreshAccountInfo,
    refreshAccountRateLimits,
    alertError,
  });
  const {
    newAgentDraftWorkspaceId,
    startingDraftThreadWorkspaceId,
    startNewAgentDraft,
    clearDraftState,
    clearDraftStateIfDifferentWorkspace,
    runWithDraftStart,
  } = useNewAgentDraft({
    activeWorkspace,
    activeWorkspaceId,
    activeThreadId,
  });
  const { getThreadRows } = useThreadRows(threadParentById);

  useTrayRecentThreads({
    workspaces,
    threadsByWorkspace,
    isSubagentThread,
  });

  useAutoExitEmptyDiff({
    centerMode,
    autoExitEnabled: diffSource === "local",
    activeDiffCount: activeDiffs.length,
    activeDiffLoading,
    activeDiffError,
    activeThreadId,
    isCompact,
    setCenterMode,
    setSelectedDiffPath,
    setActiveTab,
  });

  const {
    renamePrompt: renameWorktreePrompt,
    notice: renameWorktreeNotice,
    upstreamPrompt: renameWorktreeUpstreamPrompt,
    confirmUpstream: confirmRenameWorktreeUpstream,
    openRenamePrompt: openRenameWorktreePrompt,
    handleRenameChange: handleRenameWorktreeChange,
    handleRenameCancel: handleRenameWorktreeCancel,
    handleRenameConfirm: handleRenameWorktreeConfirm,
  } = useRenameWorktreePrompt({
    workspaces,
    activeWorkspaceId,
    renameWorktree,
    renameWorktreeUpstream,
    onRenameSuccess: (workspace) => {
      resetWorkspaceThreads(workspace.id);
      void listThreadsForWorkspace(workspace);
      if (activeThreadId && activeWorkspaceId === workspace.id) {
        void refreshThread(workspace.id, activeThreadId);
      }
    },
  });

  const handleOpenRenameWorktree = useCallback(() => {
    if (activeWorkspace) {
      openRenameWorktreePrompt(activeWorkspace.id);
    }
  }, [activeWorkspace, openRenameWorktreePrompt]);

  const {
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureTerminalWithTitle,
    restartTerminalSession,
    requestTerminalFocus,
  } = useTerminalController({
    activeWorkspace,
    activeThreadId,
    terminalOpen: terminalOpen || isTerminalPreviewActive,
    layoutResizeKey: `${sidebarCollapsed}:${rightPanelCollapsed}:${isTerminalPreviewActive}`,
    onCloseTerminalPanel: closeTerminalPanel,
    onDebug: addDebugEntry,
    onPreviewFile: handlePreviewFile,
  });

  const openTerminalWithFocus = useCallback(() => {
    if (!activeThreadId) {
      return;
    }
    requestTerminalFocus();
    if (terminalTabs.length === 0) {
      onNewTerminal();
    }
    openTerminal();
  }, [activeThreadId, onNewTerminal, openTerminal, requestTerminalFocus, terminalTabs.length]);

  const pendingTerminalOpenForNextThreadRef = useRef(false);

  const resolveClaudeModelId = useCallback(
    (override?: string | null) => {
      const id = (override ?? selectedModel?.model ?? "").trim();
      return id.length > 0 ? id : "glm-5.2";
    },
    [selectedModel],
  );

  const applyTerminalTitle = useCallback(
    (terminalId: string, modelId: string) => {
      if (!activeThreadId || !activeWorkspace) {
        return;
      }
      ensureTerminalWithTitle(
        activeThreadId,
        terminalId,
        `Claude Code@${modelId}`,
        activeWorkspace.path,
      );
    },
    [activeThreadId, activeWorkspace, ensureTerminalWithTitle],
  );

  const handleToggleTerminalWithFocus = useCallback(() => {
    if (!activeThreadId) {
      pendingTerminalOpenForNextThreadRef.current = true;
      if (activeWorkspace) {
        void startThreadForWorkspace(activeWorkspace.id, {
          activate: true,
          accessMode,
        });
      }
      return;
    }
    if (terminalOpen) {
      closeTerminalPanel();
      return;
    }
    requestTerminalFocus();
    if (terminalTabs.length === 0) {
      const newTerminalId = onNewTerminal();
      if (newTerminalId && activeWorkspace) {
        const claudeModelId = resolveClaudeModelId();
        applyTerminalTitle(newTerminalId, claudeModelId);
      }
    }
    openTerminal();
  }, [
    accessMode,
    activeThreadId,
    activeWorkspace,
    applyTerminalTitle,
    closeTerminalPanel,
    onNewTerminal,
    openTerminal,
    requestTerminalFocus,
    resolveClaudeModelId,
    startThreadForWorkspace,
    terminalOpen,
    terminalTabs.length,
  ]);

  const handleNewClaudeTerminal = useCallback((modelOverride?: string | null) => {
    if (!activeThreadId) {
      return;
    }
    requestTerminalFocus();
    const newTerminalId = onNewTerminal();
    if (newTerminalId && activeWorkspace) {
      const claudeModelId = resolveClaudeModelId(modelOverride);
      applyTerminalTitle(newTerminalId, claudeModelId);
    }
    openTerminal();
  }, [
    activeThreadId,
    activeWorkspace,
    applyTerminalTitle,
    onNewTerminal,
    openTerminal,
    requestTerminalFocus,
    resolveClaudeModelId,
  ]);

  // 打开一个普通终端（不启动 claude code，也不写入自动命令）。
  const handleOpenPlainTerminal = openTerminalWithFocus;

  useEffect(() => {
    if (!activeThreadId || !pendingTerminalOpenForNextThreadRef.current) {
      return;
    }
    pendingTerminalOpenForNextThreadRef.current = false;
    if (terminalTabs.length === 0) {
      const newTerminalId = onNewTerminal();
      if (newTerminalId && activeWorkspace) {
        const claudeModelId = resolveClaudeModelId();
        applyTerminalTitle(newTerminalId, claudeModelId);
      }
    }
    openTerminalForThread(activeThreadId);
    requestTerminalFocus();
  }, [
    activeThreadId,
    activeWorkspace,
    applyTerminalTitle,
    onNewTerminal,
    openTerminalForThread,
    requestTerminalFocus,
    resolveClaudeModelId,
    terminalTabs.length,
  ]);

  const launchScriptsState = useWorkspaceLaunchScripts({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal: openTerminalWithFocus,
    ensureLaunchTerminal: (workspaceId, entry, title) => {
      const label = entry.label?.trim() || entry.icon;
      return ensureTerminalWithTitle(
        workspaceId,
        `launch:${entry.id}`,
        title || `Launch ${label}`,
        activeWorkspace?.path ?? "",
      );
    },
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });

  const worktreeSetupScriptState = useWorktreeSetupScript({
    ensureTerminalWithTitle,
    restartTerminalSession,
    openTerminal,
    onDebug: addDebugEntry,
  });

  const handleWorktreeCreated = useCallback(
    async (worktree: WorkspaceInfo, _parentWorkspace?: WorkspaceInfo) => {
      await worktreeSetupScriptState.maybeRunWorktreeSetupScript(worktree);
    },
    [worktreeSetupScriptState],
  );

  const { exitDiffView, selectWorkspace, selectHome } = useWorkspaceSelection({
    workspaces,
    isCompact,
    activeWorkspaceId,
    setActiveTab,
    setActiveWorkspaceId,
    updateWorkspaceSettings,
    setCenterMode,
    setSelectedDiffPath,
  });

  const resolveCloneProjectContext = useCallback(
    (workspace: WorkspaceInfo) => {
      const groupId = workspace.settings.groupId ?? null;
      const group = groupId
        ? appSettings.workspaceGroups.find((entry) => entry.id === groupId)
        : null;
      return {
        groupId,
        copiesFolder: group?.copiesFolder ?? null,
      };
    },
    [appSettings.workspaceGroups],
  );

  const {
    handleSelectOpenAppId,
    persistProjectCopiesFolder,
  } = useMainAppSettingsActions({
    appSettings,
    setAppSettings,
    queueSaveSettings,
  });

  const openAppIconById = useOpenAppIcons(appSettings.openAppTargets);

  const activeRateLimits = activeWorkspaceId
    ? rateLimitsByWorkspace[activeWorkspaceId] ?? null
    : null;

  const {
    workspaceFromUrlPrompt,
    openWorkspaceFromUrlPrompt,
    closeWorkspaceFromUrlPrompt,
    chooseWorkspaceFromUrlDestinationPath,
    submitWorkspaceFromUrlPrompt,
    updateWorkspaceFromUrlUrl,
    updateWorkspaceFromUrlTargetFolderName,
    clearWorkspaceFromUrlDestinationPath,
    canSubmitWorkspaceFromUrlPrompt,
  } = useWorkspaceFromUrlPrompt({
    onSubmit: async (url, destinationPath, targetFolderName) => {
      await handleAddWorkspaceFromGitUrl(url, destinationPath, targetFolderName);
    },
  });

  const { appModalsProps, modalActions } = useMainAppModals({
    settingsViewComponent: SettingsView,
    workspaces,
    groupedWorkspaces,
    activeWorkspaceName: activeWorkspace?.name ?? null,
    accountInfo: activeAccount,
    accountSwitching,
    onSwitchAccount: handleSwitchAccount,
    onCancelSwitchAccount: handleCancelSwitchAccount,
    updater,
    activeWorkspace,
    setActiveWorkspaceId,
    branches,
    currentBranch,
    threadRename: {
      threadsByWorkspace,
      renameThread,
    },
    git: {
      checkoutBranch: handleCheckoutBranch,
      initGitRepo: handleInitGitRepo,
      createGitHubRepo: handleCreateGitHubRepo,
      refreshGitRemote,
      initGitRepoLoading,
      createGitHubRepoLoading,
    },
    workspacePrompts: {
      addWorktreeAgent,
      addCloneAgent,
      connectWorkspace,
      updateWorkspaceSettings,
      selectWorkspace,
      handleWorktreeCreated,
      resolveCloneProjectContext,
      persistProjectCopiesFolder,
      onCompactActivate: isCompact ? () => setActiveTab("chat") : undefined,
      onWorkspacePromptError: (message, kind) => {
        addDebugEntry({
          id: `${Date.now()}-client-add-${kind}-error`,
          timestamp: Date.now(),
          source: "error",
          label: `${kind}/add error`,
          payload: message,
        });
      },
      mobileRemoteWorkspacePathPrompt,
      updateMobileRemoteWorkspacePathInput,
      appendMobileRemoteWorkspacePathFromRecent,
      cancelMobileRemoteWorkspacePathPrompt,
      submitMobileRemoteWorkspacePathPrompt,
      openWorkspaceFromUrlPrompt,
      workspaceFromUrl: {
        workspaceFromUrlPrompt,
        workspaceFromUrlCanSubmit: canSubmitWorkspaceFromUrlPrompt,
        onWorkspaceFromUrlPromptUrlChange: updateWorkspaceFromUrlUrl,
        onWorkspaceFromUrlPromptTargetFolderNameChange:
          updateWorkspaceFromUrlTargetFolderName,
        onWorkspaceFromUrlPromptChooseDestinationPath:
          chooseWorkspaceFromUrlDestinationPath,
        onWorkspaceFromUrlPromptClearDestinationPath:
          clearWorkspaceFromUrlDestinationPath,
        onWorkspaceFromUrlPromptCancel: closeWorkspaceFromUrlPrompt,
        onWorkspaceFromUrlPromptConfirm: submitWorkspaceFromUrlPrompt,
      },
    },
    settings: {
      reduceTransparency,
      setReduceTransparency,
      appSettings,
      accountRateLimits: activeRateLimits,
      openAppIconById,
      onPluginsChanged: () => refreshConfiguredPlugins({ force: true }),
      queueSaveSettings,
      doctor,
      codexUpdate,
      updateWorkspaceSettings,
      scaleShortcutTitle,
      scaleShortcutText,
      handleTestNotificationSound,
      handleTestSystemNotification,
      handleMobileConnectSuccess,
    },
  });

  useBranchSwitcherShortcut({
    shortcut: appSettings.branchSwitcherShortcut,
    isEnabled: isBranchSwitcherEnabled,
    onTrigger: modalActions.openBranchSwitcher,
  });

  const handleRenameThread = useCallback(
    (workspaceId: string, threadId: string) => {
      modalActions.openRenamePrompt(workspaceId, threadId);
    },
    [modalActions],
  );

  const showHome = false;

  useEffect(() => {
    if (showHome || !hasLoaded || activeWorkspace || workspaces.length === 0) {
      return;
    }
    setActiveWorkspaceId(workspaces[0]?.id ?? null);
  }, [activeWorkspace, hasLoaded, setActiveWorkspaceId, showHome, workspaces]);

  const activeTokenUsage = activeThreadId
    ? tokenUsageByThread[activeThreadId] ?? null
    : null;
  useTraySessionUsage({
    accountRateLimits: activeRateLimits,
    showRemaining: appSettings.usageShowRemaining,
  });
  const activePlan = activeThreadId
    ? planByThread[activeThreadId] ?? null
    : null;
  const activeGoal = activeThreadId
    ? goalByThread[activeThreadId] ?? null
    : null;
  const [sidebarViewMode, setSidebarViewMode] = useState<"workspace" | "files">("workspace");

  useEffect(() => {
    if (!activeWorkspace) {
      setSidebarViewMode("workspace");
    }
  }, [activeWorkspace]);

  const composerWorkspaceState = useMainAppComposerWorkspaceState({
    view: {
      activeTab,
      tabletTab,
      centerMode,
      isCompact,
      isTablet: false,
      rightPanelCollapsed,
      sidebarViewMode,
    },
    workspace: {
      activeWorkspace,
      activeWorkspaceId,
      startingDraftThreadWorkspaceId,
      threadsByWorkspace,
    },
    thread: {
      activeThreadId,
      activeItems,
      threadStatusById,
      activeTurnIdByThread,
      userInputRequests,
    },
    settings: {
      steerEnabled: appSettings.steerEnabled,
      followUpMessageBehavior: appSettings.followUpMessageBehavior,
      experimentalAppsEnabled: appSettings.experimentalAppsEnabled,
      pauseQueuedMessagesWhenResponseRequired:
        appSettings.pauseQueuedMessagesWhenResponseRequired,
    },
    models: {
      models,
      selectedModelId,
      resolvedEffort,
      selectedServiceTier,
      collaborationModePayload,
      accessMode,
    },
    refs: {
      composerInputRef,
      workspaceHomeTextareaRef,
    },
    actions: {
      connectWorkspace,
      startThreadForWorkspace,
      sendUserMessage,
      sendUserMessageToThread,
      seedThreadCodexParams: patchThreadCodexParams,
      startFork,
      startReview,
      startResume,
      startCompact,
      startApps,
      startMcp,
      startFast,
      startStatus,
      addWorktreeAgent,
      handleWorktreeCreated,
      addDebugEntry,
    },
  });
  const {
    files,
    setFileAutocompleteActive,
    showWorkspaceHome,
    showComposer,
    canInterrupt,
    recentThreadInstances,
    recentThreadsUpdatedAt,
    clearActiveImages,
    removeImagesForThread,
    handleSend,
    setPrefillDraft,
    clearDraftForThread,
    workspaceHomeState,
    agentMdState,
  } = composerWorkspaceState;
  const {
    runs: workspaceRuns,
    draft: workspacePrompt,
    runMode: workspaceRunMode,
    modelSelections: workspaceModelSelections,
    error: workspaceRunError,
    isSubmitting: workspaceRunSubmitting,
    setDraft: setWorkspacePrompt,
    setRunMode: setWorkspaceRunMode,
    toggleModelSelection: toggleWorkspaceModelSelection,
    setModelCount: setWorkspaceModelCount,
    startRun: startWorkspaceRun,
  } = workspaceHomeState;
  const {
    content: agentMdContent,
    exists: agentMdExists,
    truncated: agentMdTruncated,
    isLoading: agentMdLoading,
    isSaving: agentMdSaving,
    error: agentMdError,
    isDirty: agentMdDirty,
    setContent: setAgentMdContent,
    refresh: refreshAgentMd,
    save: saveAgentMd,
  } = agentMdState;
  const promptActions = useMainAppPromptActions({
    activeWorkspace,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessageToThread,
    alertError,
    createPrompt,
    updatePrompt,
    deletePrompt,
    movePrompt,
    getWorkspacePromptsDir,
    getGlobalPromptsDir,
  });
  const worktreeState = useMainAppWorktreeState({
    activeWorkspace,
    workspacesById,
    renameWorktreePrompt,
    renameWorktreeNotice,
    renameWorktreeUpstreamPrompt,
    confirmRenameWorktreeUpstream,
    handleOpenRenameWorktree,
    handleRenameWorktreeChange,
    handleRenameWorktreeCancel,
    handleRenameWorktreeConfirm,
  });
  const { baseWorkspaceRef } = worktreeState;

  useMainAppWorkspaceLifecycle({
    authReady,
    activeTab,
    isTablet: false,
    setActiveTab,
    workspaces,
    hasLoaded,
    connectWorkspace,
    listThreadsForWorkspaces,
    refreshWorkspaces,
    backendMode: appSettings.backendMode,
    activeWorkspace,
    activeThreadId,
    threadStatusById,
    remoteThreadConnectionState,
    refreshThread,
  });

  const {
    handleAddWorkspace,
    handleAddWorkspaceFromGitUrl,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    dropTargetRef: workspaceDropTargetRef,
    isDragOver: isWorkspaceDropActive,
    handleDragOver: handleWorkspaceDragOver,
    handleDragEnter: handleWorkspaceDragEnter,
    handleDragLeave: handleWorkspaceDragLeave,
    handleDrop: handleWorkspaceDrop,
  } = useMainAppWorkspaceActions({
    workspaceActions: {
      isCompact,
      addWorkspace,
      addWorkspaceFromPath,
      addWorkspaceFromGitUrl,
      addWorkspacesFromPaths,
      setActiveThreadId,
      setActiveTab,
      exitDiffView,
      selectWorkspace,
      onStartNewAgentDraft: startNewAgentDraft,
      openWorktreePrompt: modalActions.openWorktreePrompt,
      openClonePrompt: modalActions.openClonePrompt,
      composerInputRef,
      onDebug: addDebugEntry,
    },
  });

  const handlePreviewSideChat = useCallback(() => {
    if (!activeWorkspace) {
      return;
    }
    void handleAddAgent(activeWorkspace);
  }, [activeWorkspace, handleAddAgent]);
  const handlePreviewTerminal = useCallback(() => {
    setPreviewTabs((current) =>
      current.includes("terminal:") ? current : [...current, "terminal:"],
    );
    setPreviewPath("terminal:");
    onNewTerminal();
  }, [onNewTerminal]);

  const handlePreviewCanvas = useCallback(() => {
    setPreviewTabs((current) =>
      current.includes("canvas:") ? current : [...current, "canvas:"],
    );
    setPreviewPath("canvas:");
    if (rightPanelCollapsed) {
      expandRightPanel();
    }
  }, [rightPanelCollapsed, expandRightPanel]);

  useInterruptShortcut({
    isEnabled: canInterrupt,
    shortcut: appSettings.interruptShortcut,
    onTrigger: () => {
      void interruptTurn();
    },
  });

  const selectedCommitEntry = useMemo(() => {
    if (!selectedCommitSha) {
      return null;
    }
    return (
      [...gitLogAheadEntries, ...gitLogBehindEntries, ...gitLogEntries].find(
        (entry) => entry.sha === selectedCommitSha,
      ) ?? null
    );
  }, [gitLogAheadEntries, gitLogBehindEntries, gitLogEntries, selectedCommitSha]);

  const {
    handleSelectPullRequest,
    resetPullRequestSelection,
    composerContextActions,
    composerSendLabel,
    handleComposerSend,
  } = usePullRequestComposer({
    activeWorkspace,
    selectedPullRequest,
    selectedCommit: selectedCommitEntry,
    gitPanelMode,
    centerMode,
    isCompact,
    setSelectedPullRequest,
    setDiffSource,
    setSelectedDiffPath,
    setCenterMode,
    setGitPanelMode,
    setPrefillDraft,
    setActiveTab,
    pullRequestReviewActions,
    pullRequestReviewLaunching: isLaunchingPullRequestReview,
    runPullRequestReview,
    startReview,
    clearActiveImages,
    handleSend,
  });

  const {
    handleComposerSendWithDraftStart,
    handleSelectWorkspaceInstance,
    handleOpenThreadLink,
    handleArchiveActiveThread,
  } = useThreadUiOrchestration({
    activeWorkspaceId,
    activeThreadId,
    accessMode,
    selectedServiceTier,
    selectedCollaborationModeId,
    selectedCodexArgsOverride,
    pendingNewThreadSeedRef,
    runWithDraftStart,
    handleComposerSend,
    clearDraftState,
    exitDiffView,
    resetPullRequestSelection,
    selectWorkspace,
    setActiveThreadId,
    setActiveTab,
    isCompact,
    removeThread,
    clearDraftForThread,
    removeImagesForThread,
  });

  const handleOpenThreadLinkFromExternal = useCallback(
    (workspaceId: string, threadId: string) => {
      setActiveTab("chat");
      handleOpenThreadLink(threadId, workspaceId);
    },
    [handleOpenThreadLink, setActiveTab],
  );

  const { recordPendingThreadLink, openThreadLinkOrQueue } =
    useSystemNotificationThreadLinks({
      hasLoadedWorkspaces: hasLoaded,
      workspacesById,
      refreshWorkspaces,
      connectWorkspace,
      openThreadLink: handleOpenThreadLinkFromExternal,
    });

  useTauriEvent(
    subscribeTrayOpenThread,
    ({ workspaceId, threadId }: { workspaceId: string; threadId: string }) => {
      openThreadLinkOrQueue(workspaceId, threadId);
    },
  );

  useEffect(() => {
    recordPendingThreadLinkRef.current = recordPendingThreadLink;
    return () => {
      recordPendingThreadLinkRef.current = () => {};
    };
  }, [recordPendingThreadLink]);

  const { handlePlanAccept } = usePlanReadyActions({
    activeWorkspace,
    activeThreadId,
    collaborationModes,
    resolvedModel,
    resolvedEffort,
    connectWorkspace,
    sendUserMessageToThread,
    setSelectedCollaborationModeId,
    persistThreadCodexParams,
  });

  const {
    isThreadOpen,
    dropOverlayActive,
    dropOverlayText,
    appClassName,
    appStyle,
  } = useAppShellOrchestration({
    isCompact,
    isPhone,
    isTablet: false,
    sidebarCollapsed,
    rightPanelCollapsed,
    shouldReduceTransparency,
    isWorkspaceDropActive,
    showComposer,
    activeThreadId,
    sidebarWidth,
    chatDiffSplitPositionPercent,
    rightPanelWidth,
    rightPanelWidthPx,
    terminalPanelHeight,
    debugPanelHeight,
    appSettings,
  });

  const sidebarMenuOrchestration = useMainAppSidebarMenuOrchestration({
    sidebarActions: {
      openSettings: modalActions.openSettings,
      resetPullRequestSelection,
      clearDraftState,
      clearDraftStateIfDifferentWorkspace,
      selectHome,
      exitDiffView,
      selectWorkspace,
      setActiveThreadId,
      workspacesById,
      updateWorkspaceSettings,
      removeThread,
      clearDraftForThread,
      removeImagesForThread,
      refreshThread,
      handleRenameThread,
      removeWorkspace,
      removeWorktree,
      loadOlderThreadsForWorkspace,
      listThreadsForWorkspace,
    },
    workspaceCycling: {
      workspaces,
      groupedWorkspaces,
      threadsByWorkspace,
      getThreadRows,
      getPinTimestamp,
      pinnedThreadsVersion,
      activeWorkspaceIdRef,
      activeThreadIdRef,
      exitDiffView,
      resetPullRequestSelection,
      selectWorkspace,
      setActiveThreadId,
    },
    appMenu: {
      activeWorkspaceRef,
      baseWorkspaceRef,
      onAddWorkspace: handleAddWorkspace,
      onAddWorkspaceFromUrl: openWorkspaceFromUrlPrompt,
      onAddAgent: handleAddAgent,
      onAddWorktreeAgent: handleAddWorktreeAgent,
      onAddCloneAgent: handleAddCloneAgent,
      onToggleDebug: handleDebugClick,
      onToggleTerminal: handleToggleTerminalWithFocus,
      sidebarCollapsed,
      rightPanelCollapsed,
      onExpandSidebar: expandSidebar,
      onCollapseSidebar: collapseSidebar,
      onExpandRightPanel: expandRightPanel,
      onCollapseRightPanel: collapseRightPanel,
    },
    appSettings,
    onDebug: addDebugEntry,
  });
  useArchiveShortcut({
    isEnabled: isThreadOpen,
    shortcut: appSettings.archiveThreadShortcut,
    onTrigger: handleArchiveActiveThread,
  });
  const showCompactChatThreadActions =
    Boolean(activeWorkspace) &&
    isCompact &&
    (isPhone && activeTab === "chat");
  const showMobilePollingFetchStatus =
    showCompactChatThreadActions &&
    Boolean(activeWorkspace?.connected) &&
    appSettings.backendMode === "remote" &&
    remoteThreadConnectionState === "polling";
  const gitRootOverride = activeWorkspace?.settings.gitRoot;
  const hasGitRootOverride =
    typeof gitRootOverride === "string" && gitRootOverride.trim().length > 0;
  const showGitInitBanner =
    Boolean(activeWorkspace) && !hasGitRootOverride && isMissingRepo(gitStatus.error);
  const displayNodes = useMainAppDisplayNodes({
    showCompactChatThreadActions,
    handleMobileThreadRefresh,
    mobileThreadRefreshLoading,
    centerMode,
    gitDiffViewStyle,
    setGitDiffViewStyle,
    isCompact,
    rightPanelCollapsed,
    sidebarToggleProps,
    workspaceHomeProps: activeWorkspace
      ? {
          workspace: activeWorkspace,
          availableWorkspaces: workspaces,
          onSelectWorkspace: selectWorkspace,
          showGitInitBanner,
          initGitRepoLoading,
          onInitGitRepo: modalActions.openInitGitRepoPrompt,
          runs: workspaceRuns,
          recentThreadInstances,
          recentThreadsUpdatedAt,
          prompt: workspacePrompt,
          onPromptChange: setWorkspacePrompt,
          onStartRun: startWorkspaceRun,
          runMode: workspaceRunMode,
          onRunModeChange: setWorkspaceRunMode,
          models,
          selectedModelId,
          onSelectModel: setSelectedModelId,
          modelSelections: workspaceModelSelections,
          onToggleModel: toggleWorkspaceModelSelection,
          onModelCountChange: setWorkspaceModelCount,
          collaborationModes,
          selectedCollaborationModeId,
          onSelectCollaborationMode: setSelectedCollaborationModeId,
          reasoningOptions,
          selectedEffort,
          onSelectEffort: setSelectedEffort,
          reasoningSupported,
          selectedServiceTier: selectedServiceTier ?? null,
          accessMode,
          onSelectAccessMode: setAccessMode,
          contextUsage: null,
          error: workspaceRunError,
          isSubmitting: workspaceRunSubmitting,
          activeWorkspaceId,
          activeThreadId,
          threadStatusById,
          onSelectInstance: handleSelectWorkspaceInstance,
          skills,
          plugins: configuredPlugins,
          onRefreshSkills: refreshSkills,
          onRefreshPlugins: () => refreshConfiguredPlugins({ force: true }),
          appsEnabled: appSettings.experimentalAppsEnabled,
          apps,
          prompts,
          files,
          onFileAutocompleteActiveChange: setFileAutocompleteActive,
          textareaRef: workspaceHomeTextareaRef,
          agentMdContent,
          agentMdExists,
          agentMdTruncated,
          agentMdLoading,
          agentMdSaving,
          agentMdError,
          agentMdDirty,
          onAgentMdChange: setAgentMdContent,
          onAgentMdRefresh: () => {
            void refreshAgentMd();
          },
          onAgentMdSave: () => {
            void saveAgentMd();
          },
          onPreviewAttachment: handlePreviewFile,
          attachments: composerWorkspaceState.activeImages,
          onPickImages: composerWorkspaceState.pickImages,
          onAttachImages: composerWorkspaceState.attachImages,
          onRemoveAttachment: composerWorkspaceState.removeImage,
          onClearAttachments: composerWorkspaceState.clearActiveImages,
          onToggleTerminal: handleToggleTerminalWithFocus,
          terminalOpen,
        }
      : null,
  });
  const { workspaceHomeNode } = displayNodes;
  const handleInsertFileReferencesToComposer = useCallback(
    (paths: string[]) => {
      const normalized = Array.from(
        new Set(paths.map((path) => path.trim()).filter(Boolean)),
      );
      if (normalized.length === 0) {
        return;
      }
      const insert = normalized.map((path) => `@'${path}'`).join(" ");
      const existing = composerWorkspaceState.getActiveDraft().trim();
      const nextText = existing ? `${existing} ${insert}` : insert;
      composerWorkspaceState.setComposerInsert({
        id: `drop-${Date.now()}`,
        text: nextText,
        createdAt: Date.now(),
      });
    },
    [composerWorkspaceState],
  );
  const sidebarHandlersForLayout = useMemo(
    () => ({
      ...sidebarMenuOrchestration,
      onSelectWorkspace: (workspaceId: string) => {
        sidebarMenuOrchestration.onSelectWorkspace(workspaceId);
      },
      onSelectThread: (workspaceId: string, threadId: string) => {
        sidebarMenuOrchestration.onSelectThread(workspaceId, threadId);
      },
    }),
    [sidebarMenuOrchestration],
  );
  const layoutSurfaces = useMainAppLayoutSurfaces({
    appSettings: {
      usageShowRemaining: appSettings.usageShowRemaining,
      composerCodeBlockCopyUseModifier:
        appSettings.composerCodeBlockCopyUseModifier,
      showMessageFilePath: appSettings.showMessageFilePath,
      openAppTargets: appSettings.openAppTargets,
      selectedOpenAppId: appSettings.selectedOpenAppId,
      experimentalAppsEnabled: appSettings.experimentalAppsEnabled,
      followUpMessageBehavior: appSettings.followUpMessageBehavior,
      composerFollowUpHintEnabled: appSettings.composerFollowUpHintEnabled,
      splitChatDiffView: appSettings.splitChatDiffView,
      gitDiffIgnoreWhitespaceChanges:
        appSettings.gitDiffIgnoreWhitespaceChanges,
    },
    dictation: {
      dictationEnabled: appSettings.dictationEnabled,
      dictationState,
      handleToggleDictation,
      cancelDictation,
      dictationReady,
      dictationError,
      dictationHint,
      openSettings: modalActions.openSettings,
    },
    workspaces,
    groupedWorkspaces,
    workspaceGroupsCount: workspaceGroups.length,
    deletingWorktreeIds,
    newAgentDraftWorkspaceId,
    startingDraftThreadWorkspaceId,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    threadResumeLoadingById,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    pinnedThreadsVersion,
    threadListSortKey,
    threadListOrganizeMode,
    activeWorkspace,
    activeWorkspaceId,
    activeThreadId,
    sidebarViewMode,
    onSidebarViewModeChange: setSidebarViewMode,
    activeItems,
    userInputRequests,
    approvals,
    onDecision: handleApprovalDecision,
    onRemember: handleApprovalRemember,
    onUserInputSubmit: handleUserInputSubmit,
    onPlanAccept: handlePlanAccept,
    activePlan,
    activeGoal,
    activeTokenUsage,
    gitState,
    selectedServiceTier: selectedServiceTier ?? null,
    composerWorkspaceState,
    previewPath,
    previewTabs,
    onPreviewPathChange: handlePreviewPathChange,
    onPreviewTabClose: handlePreviewTabClose,
    onPreviewFile: handlePreviewFile,
    onPreviewSideChat: handlePreviewSideChat,
    onPreviewTerminal: handlePreviewTerminal,
    onPreviewCanvas: handlePreviewCanvas,
    promptActions,
    worktreeState,
    sidebarHandlers: sidebarHandlersForLayout,
    displayNodes,
    threadPinning: {
      pinThread,
      unpinThread,
      isThreadPinned,
      getPinTimestamp,
      getThreadArgsBadge,
    },
    workspaceDrop: {
      workspaceDropTargetRef,
      isWorkspaceDropActive: dropOverlayActive,
      workspaceDropText: dropOverlayText,
      onWorkspaceDragOver: handleWorkspaceDragOver,
      onWorkspaceDragEnter: handleWorkspaceDragEnter,
      onWorkspaceDragLeave: handleWorkspaceDragLeave,
      onWorkspaceDrop: handleWorkspaceDrop,
    },
    threadNavigation: {
      exitDiffView,
      clearDraftState,
      selectWorkspace,
      setActiveThreadId,
      resetPullRequestSelection,
      selectHome,
    },
    pullRequestComposer: {
      composerSendLabel,
      handleSelectPullRequest,
    },
    sidebarToggles: {
      sidebarCollapsed,
      rightPanelCollapsed,
      onCollapseSidebar: collapseSidebar,
    },
    openAppIconById,
    openInitGitRepoPrompt: modalActions.openInitGitRepoPrompt,
    startUncommittedReview,
    handleAddWorkspace,
    openWorkspaceFromUrlPrompt,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    handleOpenThreadLink,
    onOpenSkillsStore: openSkillsStore,
    onOpenAutomation: openAutomation,
    closeOverlays,
    handleSelectOpenAppId,
    launchScriptsState,
    models,
    selectedModelId,
    onSelectModel: handleSelectModel,
    collaborationModes,
    selectedCollaborationModeId,
    onSelectCollaborationMode: handleSelectCollaborationMode,
    reasoningOptions,
    selectedEffort,
    onSelectEffort: handleSelectEffort,
    reasoningSupported,
    accessMode,
    onSelectAccessMode: handleSelectAccessMode,
    skills,
    plugins: configuredPlugins,
    onRefreshSkills: refreshSkills,
    onRefreshPlugins: () => refreshConfiguredPlugins({ force: true }),
    apps,
    prompts,
    composerInputRef,
    composerEditorSettings,
    composerContextActions,
    reviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    selectBranch,
    selectBranchAtIndex,
    confirmBranch,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleComposerSendWithDraftStart,
    interruptTurn,
    terminalOpen,
    onToggleTerminal: handleNewClaudeTerminal,
    onComposerOpenTerminal: handleOpenPlainTerminal,
    debugOpen,
    debugEntries,
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal: handleNewClaudeTerminal,
    onCloseTerminal,
    onHideTerminalPanel: closeTerminalPanel,
    terminalState,
    onClearDebug: clearDebugEntries,
    onCopyDebug: handleCopyDebug,
    onResizeDebug: onDebugPanelResizeStart,
    isCompact,
    isPhone,
    activeTab,
    setActiveTab,
    tabletTab,
    showMobilePollingFetchStatus,
    errorToasts,
    dismissErrorToast,
    successToasts,
    dismissSuccessToast,
    showDebugButton,
    handleDebugClick,
    updater,
  });

  const {
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    updateToastNode,
    errorToastsNode,
    successToastsNode,
    homeNode,
    desktopTopbarLeftNode,
    tabBarNode,
    filePreviewPanelNode,
    gitDiffPanelNode,
    threadStatusPanelNode,
    debugPanelNode,
    terminalNode,
    compactEmptyChatNode,
  } = useMainAppLayoutNodes(layoutSurfaces);

  const skillsStoreNode = (
    <SkillsStoreView
      skills={skills}
      plugins={marketPlugins}
      pluginsLoading={marketPluginsLoading}
      onRefreshPlugins={() => {
        void refreshMarketPlugins({ force: true });
        void refreshConfiguredPlugins({ force: true });
      }}
      onRefresh={refreshSkills}
      onUseSkill={(skill) => {
        const skillName = skill.name.trim();
        const skillPath = skill.path.trim();
        const insert = `[$${skillName}:${skillName}](${skillPath})`;
        const existing = composerWorkspaceState.getActiveDraft().trim();
        const nextText = existing ? `${existing} ${insert}` : insert;
        composerWorkspaceState.setComposerInsert({
          id: `skill-${Date.now()}`,
          text: nextText,
          createdAt: Date.now(),
        });
        setSkillsStoreOpen(false);
      }}
    />
  );
  const mainMessagesNode = skillsStoreOpen
    ? skillsStoreNode
    : automationOpen
      ? <AutomationView />
      : showWorkspaceHome
        ? workspaceHomeNode
        : messagesNode;
  const mainComposerNode =
    skillsStoreOpen || automationOpen
      ? null
      : composerNode;
  const mainThreadStatusPanelNode =
    skillsStoreOpen || automationOpen || showWorkspaceHome ? null : threadStatusPanelNode;
  const mainAppShellProps = useMainAppShellProps({
    shell: {
      appClassName,
      isResizing,
      appStyle,
      appRef,
      sidebarToggleProps,
      shouldLoadGitHubPanelData,
      appModalsProps,
      showMobileSetupWizard,
      mobileSetupWizardProps,
    },
    gitHubPanelDataProps: {
      activeWorkspace,
      gitPanelMode,
      shouldLoadDiffs,
      diffSource,
      selectedPullRequestNumber: selectedPullRequest?.number ?? null,
      onIssuesChange: handleGitIssuesChange,
      onPullRequestsChange: handleGitPullRequestsChange,
      onPullRequestDiffsChange: handleGitPullRequestDiffsChange,
      onPullRequestCommentsChange: handleGitPullRequestCommentsChange,
    },
      appLayout: {
        isPhone,
      showHome,
      activeTab,
      centerMode,
      splitChatDiffView: appSettings.splitChatDiffView,
        activeWorkspace: Boolean(activeWorkspace) || skillsStoreOpen || automationOpen,
        onToggleTerminal: handleToggleTerminalWithFocus,
        sidebarNode,
      messagesNode: mainMessagesNode,
      threadStatusPanelNode: mainThreadStatusPanelNode,
      composerNode: mainComposerNode,
      onAttachFiles: handleInsertFileReferencesToComposer,
      approvalToastsNode,
      updateToastNode,
      errorToastsNode,
      successToastsNode,
      homeNode,
      desktopTopbarLeftNode,
      tabBarNode,
      filePreviewPanelNode,
      gitDiffPanelNode,
      debugPanelNode,
      terminalNode,
      compactEmptyChatNode,
      onSidebarResizeStart,
      onChatDiffSplitPositionResizeStart,
      onRightPanelResizeStart,
      onTerminalResizeStart: onTerminalPanelResizeStart,
    },
  });

  return (
    <AuthGate
      hasLoadedWorkspaces={hasLoaded}
      onSignedInChange={setAuthReady}
      addDebugEntry={addDebugEntry}
    >
      <MainAppShell {...mainAppShellProps} />
    </AuthGate>
  );
}
