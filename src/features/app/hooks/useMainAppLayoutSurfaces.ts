import type { RefObject } from "react";
import type {
  AppSettings,
  CollaborationModeOption,
  ComposerEditorSettings,
  ThreadGoal,
  TurnPlan,
  WorkspaceInfo,
  WorkspaceSurface,
} from "@/types";
import type { ThreadState } from "@/features/threads/hooks/useThreadsReducer";
import type { WorkspaceLaunchScriptsState } from "@app/hooks/useWorkspaceLaunchScripts";
import { REMOTE_THREAD_POLL_INTERVAL_MS } from "@app/hooks/useRemoteThreadRefreshOnFocus";
import type { useMainAppComposerWorkspaceState } from "@app/hooks/useMainAppComposerWorkspaceState";
import type { useMainAppDisplayNodes } from "@app/hooks/useMainAppDisplayNodes";
import type { useMainAppGitState } from "@app/hooks/useMainAppGitState";
import type { useMainAppPromptActions } from "@app/hooks/useMainAppPromptActions";
import type { useMainAppSidebarMenuOrchestration } from "@app/hooks/useMainAppSidebarMenuOrchestration";
import type { useMainAppWorktreeState } from "@app/hooks/useMainAppWorktreeState";
import type { useUpdater } from "@/features/update/hooks/useUpdater";
import type { LayoutNodesOptions } from "@/features/layout/hooks/layoutNodes/types";

type SidebarProps = LayoutNodesOptions["primary"]["sidebarProps"];
type ComposerProps = NonNullable<LayoutNodesOptions["primary"]["composerProps"]>;
type MainHeaderProps = NonNullable<LayoutNodesOptions["primary"]["mainHeaderProps"]>;
type GitDiffPanelProps = LayoutNodesOptions["git"]["gitDiffPanelProps"];

type UseMainAppLayoutSurfacesArgs = {
  appSettings: Pick<
    AppSettings,
    | "usageShowRemaining"
    | "composerCodeBlockCopyUseModifier"
    | "showMessageFilePath"
    | "openAppTargets"
    | "selectedOpenAppId"
    | "experimentalAppsEnabled"
    | "followUpMessageBehavior"
    | "composerFollowUpHintEnabled"
    | "splitChatDiffView"
    | "gitDiffIgnoreWhitespaceChanges"
  >;
  dictation: {
    dictationEnabled: boolean;
    dictationState: ComposerProps["dictationState"];
    handleToggleDictation: () => Promise<void>;
    cancelDictation: () => Promise<void>;
    dictationReady: boolean;
    dictationError: string | null;
    dictationHint: string | null;
    openSettings: (section?: "display" | "about" | "shortcuts" | "open-apps" | "git" | "token" | "features") => void;
  };
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: Array<{ id: string | null; name: string; workspaces: WorkspaceInfo[] }>;
  workspaceGroupsCount: number;
  deletingWorktreeIds: Set<string>;
  newAgentDraftWorkspaceId: string | null;
  startingDraftThreadWorkspaceId: string | null;
  threadsByWorkspace: SidebarProps["threadsByWorkspace"];
  threadParentById: SidebarProps["threadParentById"];
  threadStatusById: ThreadState["threadStatusById"];
  threadResumeLoadingById: Record<string, boolean>;
  threadListLoadingByWorkspace: SidebarProps["threadListLoadingByWorkspace"];
  threadListPagingByWorkspace: SidebarProps["threadListPagingByWorkspace"];
  threadListCursorByWorkspace: SidebarProps["threadListCursorByWorkspace"];
  pinnedThreadsVersion: number;
  threadListSortKey: SidebarProps["threadListSortKey"];
  threadListOrganizeMode: SidebarProps["threadListOrganizeMode"];
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  sidebarViewMode: "workspace" | "files";
  onSidebarViewModeChange: (mode: "workspace" | "files") => void;
  activeItems: LayoutNodesOptions["primary"]["messagesProps"]["items"];
  userInputRequests: SidebarProps["userInputRequests"];
  approvals: LayoutNodesOptions["primary"]["approvalToastsProps"]["approvals"];
  onDecision: LayoutNodesOptions["primary"]["approvalToastsProps"]["onDecision"];
  onRemember: LayoutNodesOptions["primary"]["approvalToastsProps"]["onRemember"];
  onUserInputSubmit: LayoutNodesOptions["primary"]["messagesProps"]["onUserInputSubmit"];
  onPlanAccept: LayoutNodesOptions["primary"]["messagesProps"]["onPlanAccept"];
  activePlan: TurnPlan | null;
  activeGoal: ThreadGoal | null;
  activeTokenUsage: ComposerProps["contextUsage"];
  gitState: ReturnType<typeof useMainAppGitState>;
  composerWorkspaceState: ReturnType<typeof useMainAppComposerWorkspaceState>;
  previewPath: string | null;
  previewTabs: string[];
  onPreviewPathChange: (path: string | null) => void;
  onPreviewTabClose: (path: string) => void;
  onPreviewFile: (path: string) => void;
  onPreviewSideChat: () => void;
  onPreviewTerminal: () => void;
  onPreviewCanvas: () => void;
  promptActions: ReturnType<typeof useMainAppPromptActions>;
  worktreeState: ReturnType<typeof useMainAppWorktreeState>;
  sidebarHandlers: ReturnType<typeof useMainAppSidebarMenuOrchestration>;
  displayNodes: ReturnType<typeof useMainAppDisplayNodes>;
  threadPinning: Pick<
    SidebarProps,
    "pinThread" | "unpinThread" | "isThreadPinned" | "getPinTimestamp" | "getThreadArgsBadge"
  >;
  workspaceDrop: {
    workspaceDropTargetRef: SidebarProps["workspaceDropTargetRef"];
    isWorkspaceDropActive: SidebarProps["isWorkspaceDropActive"];
    workspaceDropText: SidebarProps["workspaceDropText"];
    onWorkspaceDragOver: SidebarProps["onWorkspaceDragOver"];
    onWorkspaceDragEnter: SidebarProps["onWorkspaceDragEnter"];
    onWorkspaceDragLeave: SidebarProps["onWorkspaceDragLeave"];
    onWorkspaceDrop: SidebarProps["onWorkspaceDrop"];
  };
  threadNavigation: {
    exitDiffView: () => void;
    clearDraftState: () => void;
    selectWorkspace: (workspaceId: string) => void;
    setActiveThreadId: (threadId: string | null, workspaceId: string) => void;
    resetPullRequestSelection: () => void;
    selectHome: () => void;
  };
  pullRequestComposer: {
    composerSendLabel: string | null | undefined;
    handleSelectPullRequest: NonNullable<GitDiffPanelProps["onSelectPullRequest"]>;
  };
  sidebarToggles: {
    sidebarCollapsed: boolean;
    rightPanelCollapsed: boolean;
    onCollapseSidebar: () => void;
  };
  openAppIconById: MainHeaderProps["openAppIconById"];
  openInitGitRepoPrompt: GitDiffPanelProps["onInitGitRepo"];
  startUncommittedReview: (workspaceId: string | null) => void;
  handleAddWorkspace: (surface: WorkspaceSurface) => void;
  onOpenSkillsStore: SidebarProps["onOpenSkillsStore"];
  onOpenAutomation: SidebarProps["onOpenAutomation"];
  openWorkspaceFromUrlPrompt: () => void;
  closeOverlays: () => void;
  handleAddAgent: SidebarProps["onAddAgent"];
  handleAddWorktreeAgent: SidebarProps["onAddWorktreeAgent"];
  handleAddCloneAgent: SidebarProps["onAddCloneAgent"];
  handleOpenThreadLink: LayoutNodesOptions["primary"]["messagesProps"]["onOpenThreadLink"];
  handleSelectOpenAppId: MainHeaderProps["onSelectOpenAppId"];
  launchScriptsState: WorkspaceLaunchScriptsState | undefined;
  models: ComposerProps["models"];
  selectedModelId: ComposerProps["selectedModelId"];
  onSelectModel: ComposerProps["onSelectModel"];
  collaborationModes: CollaborationModeOption[];
  selectedCollaborationModeId: ComposerProps["selectedCollaborationModeId"];
  onSelectCollaborationMode: ComposerProps["onSelectCollaborationMode"];
  reasoningOptions: ComposerProps["reasoningOptions"];
  selectedEffort: ComposerProps["selectedEffort"];
  onSelectEffort: ComposerProps["onSelectEffort"];
  selectedServiceTier: ComposerProps["selectedServiceTier"];
  reasoningSupported: boolean;
  accessMode: ComposerProps["accessMode"];
  onSelectAccessMode: ComposerProps["onSelectAccessMode"];
  skills: ComposerProps["skills"];
  plugins: ComposerProps["plugins"];
  onRefreshSkills: ComposerProps["onRefreshSkills"];
  onRefreshPlugins: ComposerProps["onRefreshPlugins"];
  apps: ComposerProps["apps"];
  prompts: ComposerProps["prompts"];
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  composerEditorSettings: ComposerEditorSettings;
  composerContextActions: ComposerProps["contextActions"];
  reviewPrompt: ComposerProps["reviewPrompt"];
  closeReviewPrompt: () => void;
  showPresetStep: () => void;
  choosePreset: ComposerProps["onReviewPromptChoosePreset"];
  highlightedPresetIndex: number;
  setHighlightedPresetIndex: (index: number) => void;
  highlightedBranchIndex: number;
  setHighlightedBranchIndex: (index: number) => void;
  highlightedCommitIndex: number;
  setHighlightedCommitIndex: (index: number) => void;
  handleReviewPromptKeyDown: ComposerProps["onReviewPromptKeyDown"];
  selectBranch: ComposerProps["onReviewPromptSelectBranch"];
  selectBranchAtIndex: ComposerProps["onReviewPromptSelectBranchAtIndex"];
  confirmBranch: ComposerProps["onReviewPromptConfirmBranch"];
  selectCommit: ComposerProps["onReviewPromptSelectCommit"];
  selectCommitAtIndex: ComposerProps["onReviewPromptSelectCommitAtIndex"];
  confirmCommit: ComposerProps["onReviewPromptConfirmCommit"];
  updateCustomInstructions: ComposerProps["onReviewPromptUpdateCustomInstructions"];
  confirmCustom: ComposerProps["onReviewPromptConfirmCustom"];
  handleComposerSendWithDraftStart: ComposerProps["onSend"];
  interruptTurn: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onComposerOpenTerminal: () => void;
  debugOpen: boolean;
  debugEntries: LayoutNodesOptions["secondary"]["debugPanelProps"]["entries"];
  terminalTabs: LayoutNodesOptions["secondary"]["terminalDockProps"]["terminals"];
  activeTerminalId: LayoutNodesOptions["secondary"]["terminalDockProps"]["activeTerminalId"];
  onSelectTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onSelectTerminal"];
  onNewTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onNewTerminal"];
  onCloseTerminal: LayoutNodesOptions["secondary"]["terminalDockProps"]["onCloseTerminal"];
  onHideTerminalPanel: LayoutNodesOptions["secondary"]["terminalDockProps"]["onHideTerminalPanel"];
  terminalState: LayoutNodesOptions["secondary"]["terminalState"];
  onClearDebug: () => void;
  onCopyDebug: () => void;
  onResizeDebug: LayoutNodesOptions["secondary"]["debugPanelProps"]["onResizeStart"];
  isCompact: boolean;
  isPhone: boolean;
  activeTab: LayoutNodesOptions["primary"]["tabBarProps"]["activeTab"];
  setActiveTab: (tab: "home" | "projects" | "chat" | "git" | "log") => void;
  tabletTab: LayoutNodesOptions["primary"]["tabletNavProps"]["activeTab"];
  showMobilePollingFetchStatus: boolean;
  errorToasts: LayoutNodesOptions["primary"]["errorToastsProps"]["toasts"];
  dismissErrorToast: LayoutNodesOptions["primary"]["errorToastsProps"]["onDismiss"];
  successToasts: LayoutNodesOptions["primary"]["successToastsProps"]["toasts"];
  dismissSuccessToast: LayoutNodesOptions["primary"]["successToastsProps"]["onDismiss"];
  showDebugButton: boolean;
  handleDebugClick: () => void;
  updater: ReturnType<typeof useUpdater>;
};

type MainAppLayoutSurfacesContext = UseMainAppLayoutSurfacesArgs;

function buildPrimarySurface({
  appSettings,
  dictation,
  workspaces,
  groupedWorkspaces,
  workspaceGroupsCount,
  deletingWorktreeIds,
  newAgentDraftWorkspaceId,
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
  onSidebarViewModeChange,
  activeItems,
  userInputRequests,
  approvals,
  onDecision,
  onRemember,
  onUserInputSubmit,
  onPlanAccept,
  activePlan,
  activeGoal,
  activeTokenUsage,
  gitState,
  composerWorkspaceState,
  onPreviewFile,
  onPreviewCanvas,
  worktreeState,
  sidebarHandlers,
  displayNodes,
  threadPinning,
  workspaceDrop,
  threadNavigation,
  pullRequestComposer,
  openAppIconById,
  handleAddWorkspace,
  onOpenSkillsStore,
  onOpenAutomation,
  closeOverlays,
  handleAddAgent,
  handleAddWorktreeAgent,
  handleAddCloneAgent,
  handleOpenThreadLink,
  handleSelectOpenAppId,
  launchScriptsState,
  models,
  selectedModelId,
  onSelectModel,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  reasoningOptions,
          selectedEffort,
          onSelectEffort,
          selectedServiceTier,
          reasoningSupported,
          accessMode,
  onSelectAccessMode,
  skills,
  plugins,
  onRefreshSkills,
  onRefreshPlugins,
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
  onComposerOpenTerminal,
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
  sidebarToggles,
}: MainAppLayoutSurfacesContext): LayoutNodesOptions["primary"] {
  const updateState = updater?.state ?? { stage: "idle" };
  return {
    sidebarProps: {
      workspaces,
      groupedWorkspaces,
      hasWorkspaceGroups: workspaceGroupsCount > 0,
      deletingWorktreeIds,
      newAgentDraftWorkspaceId,
      threadsByWorkspace,
      threadParentById,
      threadStatusById,
      threadListLoadingByWorkspace,
      threadListPagingByWorkspace,
      threadListCursorByWorkspace,
      pinnedThreadsVersion,
      threadListSortKey,
      threadListOrganizeMode,
      activeWorkspaceId,
      activeThreadId,
      sidebarViewMode,
      onSidebarViewModeChange,
      userInputRequests,
      onOpenSettings: sidebarHandlers.onOpenSettings,
      onOpenDebug: handleDebugClick,
      showDebugButton,
      onAddWorkspace: handleAddWorkspace,
      onOpenSkillsStore,
      onOpenAutomation,
      onSelectWorkspace: (id: string) => {
        closeOverlays();
        sidebarHandlers.onSelectWorkspace(id);
      },
      onAddAgent: (workspace: WorkspaceInfo) => {
        closeOverlays();
        handleAddAgent(workspace);
      },
      onAddWorktreeAgent: handleAddWorktreeAgent,
      onAddCloneAgent: handleAddCloneAgent,
      onToggleWorkspaceCollapse: sidebarHandlers.onToggleWorkspaceCollapse,
      onSelectThread: (workspaceId: string, threadId: string) => {
        closeOverlays();
        sidebarHandlers.onSelectThread(workspaceId, threadId);
      },
      onDeleteThread: sidebarHandlers.onDeleteThread,
      onSyncThread: sidebarHandlers.onSyncThread,
      pinThread: threadPinning.pinThread,
      unpinThread: threadPinning.unpinThread,
      isThreadPinned: threadPinning.isThreadPinned,
      getPinTimestamp: threadPinning.getPinTimestamp,
      getThreadArgsBadge: threadPinning.getThreadArgsBadge,
      onRenameThread: sidebarHandlers.onRenameThread,
      onDeleteWorkspace: sidebarHandlers.onDeleteWorkspace,
      onDeleteWorktree: sidebarHandlers.onDeleteWorktree,
      onLoadOlderThreads: sidebarHandlers.onLoadOlderThreads,
      onReloadWorkspaceThreads: sidebarHandlers.onReloadWorkspaceThreads,
      workspaceDropTargetRef: workspaceDrop.workspaceDropTargetRef,
      isWorkspaceDropActive: workspaceDrop.isWorkspaceDropActive,
      workspaceDropText: workspaceDrop.workspaceDropText,
      onWorkspaceDragOver: workspaceDrop.onWorkspaceDragOver,
      onWorkspaceDragEnter: workspaceDrop.onWorkspaceDragEnter,
      onWorkspaceDragLeave: workspaceDrop.onWorkspaceDragLeave,
      onWorkspaceDrop: workspaceDrop.onWorkspaceDrop,
      fileTreeProps: activeWorkspace
        ? {
            workspaceId: activeWorkspace.id,
            workspacePath: activeWorkspace.path,
            files: composerWorkspaceState.files,
            modifiedFiles: [
              ...new Set([
                ...gitState.gitStatus.stagedFiles.map((file: { path: string }) => file.path),
                ...gitState.gitStatus.unstagedFiles.map((file: { path: string }) => file.path),
              ]),
            ],
            isLoading: composerWorkspaceState.isFilesLoading,
            onInsertText: composerWorkspaceState.handleInsertComposerText,
            onAttachFile: (path: string) => {
              const normalized = path.trim();
              const reference = normalized ? `@'${normalized}'` : "";
              if (reference) {
                composerWorkspaceState.handleInsertComposerText(reference);
              }
            },
            canInsertText: composerWorkspaceState.canInsertComposerText,
            onPreviewFile,
          }
        : null,
      sidebarCollapsed: sidebarToggles.sidebarCollapsed,
      onCollapseSidebar: sidebarToggles.onCollapseSidebar,
      mobileProjectsOnly: isPhone,
    },
    messagesProps: {
      items: activeItems,
      threadId: activeThreadId ?? null,
      workspaceId: activeWorkspace?.id ?? null,
      workspacePath: activeWorkspace?.path ?? null,
      openTargets: appSettings.openAppTargets,
      selectedOpenAppId: appSettings.selectedOpenAppId,
      codeBlockCopyUseModifier: appSettings.composerCodeBlockCopyUseModifier,
      showMessageFilePath: appSettings.showMessageFilePath,
      userInputRequests,
      onUserInputSubmit,
      onPlanAccept,
      onOpenThreadLink: handleOpenThreadLink,
      onPreviewFile,
      onOpenCanvas: onPreviewCanvas,
      onCollapseSidebar: sidebarToggles.onCollapseSidebar,
      isThinking: composerWorkspaceState.isProcessing,
      isLoadingMessages: activeThreadId
        ? threadResumeLoadingById[activeThreadId] ?? false
        : false,
      processingStartedAt: activeThreadId
        ? threadStatusById[activeThreadId]?.processingStartedAt ?? null
        : null,
      lastDurationMs: activeThreadId
        ? threadStatusById[activeThreadId]?.lastDurationMs ?? null
        : null,
      showPollingFetchStatus: showMobilePollingFetchStatus,
      pollingIntervalMs: REMOTE_THREAD_POLL_INTERVAL_MS,
    },
    threadStatusPanelProps: {
      plan: activePlan,
      goal: activeGoal,
      items: activeItems,
      isProcessing: composerWorkspaceState.isProcessing,
      collaborationModes,
      selectedCollaborationModeId,
      threadTitle: activeWorkspace && activeThreadId
        ? threadsByWorkspace[activeWorkspace.id]?.find((thread) => thread.id === activeThreadId)?.name ?? null
        : null,
      tokenUsage: activeTokenUsage,
    },
    composerProps: composerWorkspaceState.showComposer
      ? {
          onSend: handleComposerSendWithDraftStart,
          onStop: interruptTurn,
          canStop: composerWorkspaceState.canInterrupt,
          disabled: composerWorkspaceState.isReviewing,
          onFileAutocompleteActiveChange: composerWorkspaceState.setFileAutocompleteActive,
          contextUsage: activeTokenUsage,
          queuedMessages: composerWorkspaceState.activeQueue,
          queuePausedReason: composerWorkspaceState.queuePausedReason,
          sendLabel: pullRequestComposer.composerSendLabel ?? "Send",
          steerAvailable: composerWorkspaceState.steerAvailable,
          followUpMessageBehavior: appSettings.followUpMessageBehavior,
          isProcessing: composerWorkspaceState.isProcessing,
          draftText: composerWorkspaceState.activeDraft,
          onDraftChange: composerWorkspaceState.handleDraftChange,
          attachedImages: composerWorkspaceState.activeImages,
          onPreviewAttachment: onPreviewFile,
          onPickImages: composerWorkspaceState.pickImages,
          onAttachImages: composerWorkspaceState.attachImages,
          onRemoveImage: composerWorkspaceState.removeImage,
          prefillDraft: composerWorkspaceState.prefillDraft,
          onPrefillHandled: (id) => {
            if (composerWorkspaceState.prefillDraft?.id === id) {
              composerWorkspaceState.setPrefillDraft(null);
            }
          },
          insertText: composerWorkspaceState.composerInsert,
          onInsertHandled: (id) => {
            if (composerWorkspaceState.composerInsert?.id === id) {
              composerWorkspaceState.setComposerInsert(null);
            }
          },
          onEditQueued: composerWorkspaceState.handleEditQueued,
          onDeleteQueued: composerWorkspaceState.handleDeleteQueued,
          onSendQueuedNow: composerWorkspaceState.handleSendQueuedNow,
          collaborationModes,
          selectedCollaborationModeId,
          onSelectCollaborationMode,
          models,
          selectedModelId,
          onSelectModel,
          reasoningOptions,
          selectedEffort,
          onSelectEffort,
          selectedServiceTier,
          reasoningSupported,
          accessMode,
          onSelectAccessMode,
          skills,
          plugins,
          onRefreshSkills,
          onRefreshPlugins,
          appsEnabled: appSettings.experimentalAppsEnabled,
          apps,
          prompts,
          files: composerWorkspaceState.files,
          textareaRef: composerInputRef,
          historyKey: activeWorkspace?.id ?? null,
          editorSettings: composerEditorSettings,
          dictationEnabled: dictation.dictationEnabled && dictation.dictationReady,
          dictationState: dictation.dictationState,
          onToggleDictation: () => {
            void dictation.handleToggleDictation();
          },
          onCancelDictation: () => {
            void dictation.cancelDictation();
          },
          onOpenDictationSettings: () => dictation.openSettings("features"),
          onToggleTerminal: onComposerOpenTerminal,
          terminalOpen,
          dictationError: dictation.dictationError,
          dictationHint: dictation.dictationHint,
          contextActions: composerContextActions,
          reviewPrompt,
          onReviewPromptClose: closeReviewPrompt,
          onReviewPromptShowPreset: showPresetStep,
          onReviewPromptChoosePreset: choosePreset,
          highlightedPresetIndex,
          onReviewPromptHighlightPreset: setHighlightedPresetIndex,
          highlightedBranchIndex,
          onReviewPromptHighlightBranch: setHighlightedBranchIndex,
          highlightedCommitIndex,
          onReviewPromptHighlightCommit: setHighlightedCommitIndex,
          onReviewPromptKeyDown: handleReviewPromptKeyDown,
          onReviewPromptSelectBranch: selectBranch,
          onReviewPromptSelectBranchAtIndex: selectBranchAtIndex,
          onReviewPromptConfirmBranch: confirmBranch,
          onReviewPromptSelectCommit: selectCommit,
          onReviewPromptSelectCommitAtIndex: selectCommitAtIndex,
          onReviewPromptConfirmCommit: confirmCommit,
          onReviewPromptUpdateCustomInstructions: updateCustomInstructions,
          onReviewPromptConfirmCustom: confirmCustom,
        }
      : null,
    approvalToastsProps: {
      approvals,
      workspaces,
      onDecision,
      onRemember,
    },
    updateToastProps: {
      state: updateState,
      onUpdate: updater.startUpdate,
      onDismiss: updater.dismiss,
      postUpdateNotice: updater.postUpdateNotice,
      onDismissPostUpdateNotice: updater.dismissPostUpdateNotice,
    },
    errorToastsProps: {
      toasts: errorToasts,
      onDismiss: dismissErrorToast,
    },
    successToastsProps: {
      toasts: successToasts,
      onDismiss: dismissSuccessToast,
    },
    mainHeaderProps: activeWorkspace
      ? {
          workspace: activeWorkspace,
          parentName: worktreeState.activeParentWorkspace?.name ?? null,
          worktreeLabel: worktreeState.worktreeLabel,
          worktreeRename: worktreeState.worktreeRename ?? undefined,
          disableBranchMenu: worktreeState.isWorktreeWorkspace,
          parentPath: worktreeState.activeParentWorkspace?.path ?? null,
          worktreePath: worktreeState.isWorktreeWorkspace ? activeWorkspace.path : null,
          openTargets: appSettings.openAppTargets,
          openAppIconById,
          selectedOpenAppId: appSettings.selectedOpenAppId,
          onSelectOpenAppId: handleSelectOpenAppId,
          branchName: gitState.gitStatus.branchName || "unknown",
          branches: gitState.branches,
          onCheckoutBranch: gitState.handleCheckoutBranch,
          onCreateBranch: gitState.handleCreateBranch,
          showWorkspaceTools: !isCompact,
          launchScriptsState,
          extraActionsNode: displayNodes.mainHeaderActionsNode,
        }
      : null,
    desktopTopbarProps: {
      showBackToChat: gitState.centerMode === "diff",
      workspace: activeWorkspace,
      onExitDiff: () => {
        gitState.setCenterMode("chat");
        gitState.setSelectedDiffPath(null);
      },
    },
    tabletNavProps: {
      activeTab: tabletTab,
      onSelect: setActiveTab,
    },
    tabBarProps: {
      activeTab,
      onOpenSettings: isPhone ? sidebarHandlers.onOpenSettings : undefined,
      onSelect: (tab) => {
        if (tab === "home") {
          threadNavigation.resetPullRequestSelection();
          threadNavigation.clearDraftState();
          threadNavigation.selectHome();
          return;
        }
        setActiveTab(tab);
      },
    },
  };
}

function buildGitSurface({
  appSettings,
  activeWorkspace,
  gitState,
  composerWorkspaceState,
  previewPath,
  previewTabs,
  onPreviewPathChange,
  onPreviewTabClose,
  onPreviewFile,
  onPreviewSideChat,
  onPreviewTerminal,
  terminalState,
  worktreeState,
  pullRequestComposer,
  openInitGitRepoPrompt,
  startUncommittedReview,
  sidebarToggles,
  isCompact,
  isPhone,
}: MainAppLayoutSurfacesContext): LayoutNodesOptions["git"] {
  return {
    filePanelMode: gitState.filePanelMode,
    fileTreeProps: activeWorkspace
      ? {
          workspaceId: activeWorkspace.id,
          workspacePath: activeWorkspace.path,
          files: composerWorkspaceState.files,
          modifiedFiles: [
            ...new Set([
              ...gitState.gitStatus.stagedFiles.map((file: { path: string }) => file.path),
              ...gitState.gitStatus.unstagedFiles.map((file: { path: string }) => file.path),
            ]),
          ],
          isLoading: composerWorkspaceState.isFilesLoading,
          filePanelMode: gitState.filePanelMode,
          onFilePanelModeChange: gitState.setFilePanelMode,
          onInsertText: composerWorkspaceState.handleInsertComposerText,
          onAttachFile: (path: string) => {
            const normalized = path.trim();
            const reference = normalized ? `@'${normalized}'` : "";
            if (reference) {
              composerWorkspaceState.handleInsertComposerText(reference);
            }
          },
          canInsertText: composerWorkspaceState.canInsertComposerText,
          onPreviewFile,
        }
      : null,
    filePreviewPanelProps: {
      workspaceId: activeWorkspace?.id ?? null,
      workspacePath: activeWorkspace?.path ?? null,
      filePanelMode: gitState.filePanelMode,
      onFilePanelModeChange: gitState.setFilePanelMode,
      previewPath,
      previewTabs,
      onPreviewPathChange,
      onPreviewTabClose,
      onPreviewSideChat,
      onPreviewTerminal,
      isPanelVisible: isCompact || !sidebarToggles.rightPanelCollapsed,
      terminalState,
      diffPreviewEntries: gitState.activeDiffs,
      fileTreeProps: activeWorkspace
        ? {
            workspaceId: activeWorkspace.id,
            workspacePath: activeWorkspace.path,
            files: composerWorkspaceState.files,
            modifiedFiles: [
              ...new Set([
                ...gitState.gitStatus.stagedFiles.map((file: { path: string }) => file.path),
                ...gitState.gitStatus.unstagedFiles.map((file: { path: string }) => file.path),
              ]),
            ],
            isLoading: composerWorkspaceState.isFilesLoading,
            filePanelMode: gitState.filePanelMode,
            onFilePanelModeChange: gitState.setFilePanelMode,
            onInsertText: composerWorkspaceState.handleInsertComposerText,
            onAttachFile: (path: string) => {
              const normalized = path.trim();
              const reference = normalized ? `@'${normalized}'` : "";
              if (reference) {
                composerWorkspaceState.handleInsertComposerText(reference);
              }
            },
            canInsertText: composerWorkspaceState.canInsertComposerText,
            onPreviewFile,
          }
        : null,
    },
    gitDiffPanelProps: {
      workspaceId: activeWorkspace?.id ?? null,
      workspacePath: activeWorkspace?.path ?? null,
      mode: gitState.gitPanelMode,
      onModeChange: gitState.handleGitPanelModeChange,
      filePanelMode: gitState.filePanelMode,
      onFilePanelModeChange: gitState.setFilePanelMode,
      worktreeApplyLabel: "apply",
      worktreeApplyTitle: worktreeState.activeParentWorkspace?.name
        ? `Apply changes to ${worktreeState.activeParentWorkspace.name}`
        : "Apply changes to parent workspace",
      worktreeApplyLoading: worktreeState.isWorktreeWorkspace
        ? gitState.worktreeApplyLoading
        : false,
      worktreeApplyError: worktreeState.isWorktreeWorkspace
        ? gitState.worktreeApplyError
        : null,
      worktreeApplySuccess: worktreeState.isWorktreeWorkspace
        ? gitState.worktreeApplySuccess
        : false,
      onApplyWorktreeChanges: worktreeState.isWorktreeWorkspace
        ? gitState.handleApplyWorktreeChanges
        : undefined,
      branchName: gitState.gitStatus.branchName || "unknown",
      totalAdditions: gitState.gitStatus.totalAdditions,
      totalDeletions: gitState.gitStatus.totalDeletions,
      fileStatus: gitState.fileStatus,
      perFileDiffGroups: gitState.perFileDiffGroups,
      error: gitState.gitStatus.error,
      logError: gitState.gitLogError,
      logLoading: gitState.gitLogLoading,
      stagedFiles: gitState.gitStatus.stagedFiles,
      unstagedFiles: gitState.gitStatus.unstagedFiles,
      selectedPath: gitState.selectedDiffPath,
      onSelectFile:
        gitState.gitPanelMode === "perFile"
          ? gitState.handleSelectPerFileDiff
          : gitState.handleSelectDiff,
      logEntries: gitState.gitLogEntries,
      logTotal: gitState.gitLogTotal,
      logAhead: gitState.gitLogAhead,
      logBehind: gitState.gitLogBehind,
      logAheadEntries: gitState.gitLogAheadEntries,
      logBehindEntries: gitState.gitLogBehindEntries,
      logUpstream: gitState.gitLogUpstream,
      selectedCommitSha: gitState.selectedCommitSha,
      onSelectCommit: (entry) => {
        gitState.handleSelectCommit(entry.sha);
      },
      issues: gitState.gitIssues,
      issuesTotal: gitState.gitIssuesTotal,
      issuesLoading: gitState.gitIssuesLoading,
      issuesError: gitState.gitIssuesError,
      pullRequests: gitState.gitPullRequests,
      pullRequestsTotal: gitState.gitPullRequestsTotal,
      pullRequestsLoading: gitState.gitPullRequestsLoading,
      pullRequestsError: gitState.gitPullRequestsError,
      selectedPullRequest: gitState.selectedPullRequest?.number ?? null,
      onSelectPullRequest: (pullRequest) => {
        gitState.setSelectedCommitSha(null);
        pullRequestComposer.handleSelectPullRequest(pullRequest);
      },
      gitRemoteUrl: gitState.gitRemoteUrl,
      gitRoot: gitState.activeGitRoot,
      gitRootCandidates: gitState.gitRootCandidates,
      gitRootScanDepth: gitState.gitRootScanDepth,
      gitRootScanLoading: gitState.gitRootScanLoading,
      gitRootScanError: gitState.gitRootScanError,
      gitRootScanHasScanned: gitState.gitRootScanHasScanned,
      onGitRootScanDepthChange: gitState.setGitRootScanDepth,
      onScanGitRoots: gitState.scanGitRoots,
      onSelectGitRoot: (path) => {
        void gitState.handleSetGitRoot(path);
      },
      onClearGitRoot: () => {
        void gitState.handleSetGitRoot(null);
      },
      onPickGitRoot: gitState.handlePickGitRoot,
      onInitGitRepo: openInitGitRepoPrompt,
      initGitRepoLoading: gitState.initGitRepoLoading,
      onStageAllChanges: gitState.handleStageGitAll,
      onStageFile: gitState.handleStageGitFile,
      onUnstageFile: gitState.handleUnstageGitFile,
      onRevertFile: gitState.handleRevertGitFile,
      onRevertAllChanges: gitState.handleRevertAllGitChanges,
      onReviewUncommittedChanges: (workspaceId) =>
        startUncommittedReview(workspaceId ?? activeWorkspace?.id ?? null),
      commitMessage: gitState.commitMessage,
      commitMessageLoading: gitState.commitMessageLoading,
      commitMessageError: gitState.commitMessageError,
      onCommitMessageChange: gitState.handleCommitMessageChange,
      onGenerateCommitMessage: gitState.handleGenerateCommitMessage,
      onCommit: gitState.handleCommit,
      onCommitAndPush: gitState.handleCommitAndPush,
      onCommitAndSync: gitState.handleCommitAndSync,
      onPull: gitState.handlePull,
      onFetch: gitState.handleFetch,
      onPush: gitState.handlePush,
      onSync: gitState.handleSync,
      commitLoading: gitState.commitLoading,
      pullLoading: gitState.pullLoading,
      fetchLoading: gitState.fetchLoading,
      pushLoading: gitState.pushLoading,
      syncLoading: gitState.syncLoading,
      commitError: gitState.commitError,
      pullError: gitState.pullError,
      fetchError: gitState.fetchError,
      pushError: gitState.pushError,
      syncError: gitState.syncError,
      commitsAhead: gitState.gitLogAhead,
    },
    gitDiffViewerProps: {
      diffs: gitState.activeDiffs,
      selectedPath: gitState.selectedDiffPath,
      scrollRequestId: gitState.diffScrollRequestId,
      isLoading: gitState.activeDiffLoading,
      error: gitState.activeDiffError,
      ignoreWhitespaceChanges:
        appSettings.gitDiffIgnoreWhitespaceChanges && gitState.diffSource !== "pr",
      pullRequest: gitState.diffSource === "pr" ? gitState.selectedPullRequest : null,
      pullRequestComments:
        gitState.diffSource === "pr" ? gitState.gitPullRequestComments : [],
      pullRequestCommentsLoading: gitState.gitPullRequestCommentsLoading,
      pullRequestCommentsError: gitState.gitPullRequestCommentsError,
      pullRequestReviewActions: gitState.pullRequestReviewActions,
      onRunPullRequestReview: gitState.runPullRequestReview,
      pullRequestReviewLaunching: gitState.isLaunchingPullRequestReview,
      pullRequestReviewThreadId: gitState.lastPullRequestReviewThreadId,
      onCheckoutPullRequest: (pullRequest) =>
        gitState.handleCheckoutPullRequest(pullRequest.number),
      canRevert: gitState.diffSource === "local",
      onRevertFile: gitState.handleRevertGitFile,
      onActivePathChange: gitState.handleActiveDiffPath,
      onInsertComposerText: composerWorkspaceState.canInsertComposerText
        ? composerWorkspaceState.handleInsertComposerText
        : undefined,
    },
    diffViewProps: {
      centerMode: gitState.centerMode,
      isPhone,
      splitChatDiffView: appSettings.splitChatDiffView,
      gitDiffViewStyle: gitState.gitDiffViewStyle,
    },
  };
}

function buildSecondarySurface({
  gitState,
  terminalOpen,
  debugOpen,
  debugEntries,
  terminalTabs,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onHideTerminalPanel,
  terminalState,
  onClearDebug,
  onCopyDebug,
  onResizeDebug,
  isPhone,
  setActiveTab,
}: MainAppLayoutSurfacesContext): LayoutNodesOptions["secondary"] {
  return {
    terminalDockProps: {
      isOpen: terminalOpen,
      terminals: terminalTabs,
      activeTerminalId,
      onSelectTerminal,
      onNewTerminal,
      onCloseTerminal,
      onHideTerminalPanel,
    },
    terminalState,
    debugPanelProps: {
      entries: debugEntries,
      isOpen: debugOpen,
      onClear: onClearDebug,
      onCopy: onCopyDebug,
      onResizeStart: onResizeDebug,
    },
    compactNavProps: {
      onGoProjects: () => setActiveTab("projects"),
      centerMode: gitState.centerMode,
      selectedDiffPath: gitState.selectedDiffPath,
      onBackFromDiff: () => {
        gitState.setCenterMode("chat");
      },
      onShowSelectedDiff: () => {
        const fallbackPath = gitState.selectedDiffPath ?? gitState.activeDiffs[0]?.path;

        if (!fallbackPath) {
          return;
        }

        if (!gitState.selectedDiffPath) {
          gitState.setSelectedDiffPath(fallbackPath);
        }

        gitState.setCenterMode("diff");
        if (isPhone) {
          setActiveTab("git");
        }
      },
      hasActiveGitDiffs: gitState.activeDiffs.length > 0,
    },
  };
}

export function useMainAppLayoutSurfaces({
  appSettings,
  dictation,
  workspaces,
  groupedWorkspaces,
  workspaceGroupsCount,
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
  onSidebarViewModeChange,
  activeItems,
  userInputRequests,
  approvals,
  onDecision,
  onRemember,
  onUserInputSubmit,
  onPlanAccept,
  activePlan,
  activeGoal,
  activeTokenUsage,
  gitState,
  composerWorkspaceState,
  promptActions,
  worktreeState,
  sidebarHandlers,
  displayNodes,
  threadPinning,
  workspaceDrop,
  threadNavigation,
  pullRequestComposer,
  openAppIconById,
  openInitGitRepoPrompt,
  startUncommittedReview,
  handleAddWorkspace,
  onOpenSkillsStore,
  onOpenAutomation,
  closeOverlays,
  openWorkspaceFromUrlPrompt,
  handleAddAgent,
  handleAddWorktreeAgent,
  handleAddCloneAgent,
  handleOpenThreadLink,
  handleSelectOpenAppId,
  launchScriptsState,
  models,
  selectedModelId,
  onSelectModel,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  selectedServiceTier,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  skills,
  plugins,
  onRefreshSkills,
  onRefreshPlugins,
  apps,
  prompts,
  previewPath,
  previewTabs,
  onPreviewPathChange,
  onPreviewTabClose,
  onPreviewFile,
  onPreviewSideChat,
  onPreviewTerminal,
  onPreviewCanvas,
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
    onToggleTerminal,
    onComposerOpenTerminal,
    debugOpen,
  debugEntries,
  terminalTabs,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onHideTerminalPanel,
  terminalState,
  onClearDebug,
  onCopyDebug,
  onResizeDebug,
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
  sidebarToggles,
}: UseMainAppLayoutSurfacesArgs): LayoutNodesOptions {
  const context: MainAppLayoutSurfacesContext = {
    appSettings,
    dictation,
    workspaces,
    groupedWorkspaces,
    workspaceGroupsCount,
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
    onSidebarViewModeChange,
    activeItems,
    userInputRequests,
    approvals,
    onDecision,
    onRemember,
    onUserInputSubmit,
    onPlanAccept,
    activePlan,
    activeGoal,
    activeTokenUsage,
    gitState,
    composerWorkspaceState,
    previewPath,
    previewTabs,
    onPreviewPathChange,
    onPreviewTabClose,
    onPreviewFile,
    onPreviewSideChat,
    onPreviewTerminal,
    onPreviewCanvas,
    promptActions,
    worktreeState,
    sidebarHandlers,
    displayNodes,
    threadPinning,
    workspaceDrop,
    threadNavigation,
    pullRequestComposer,
    openAppIconById,
    openInitGitRepoPrompt,
    startUncommittedReview,
    handleAddWorkspace,
    onOpenSkillsStore,
    onOpenAutomation,
    closeOverlays,
    openWorkspaceFromUrlPrompt,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    handleOpenThreadLink,
    handleSelectOpenAppId,
    launchScriptsState,
    models,
    selectedModelId,
    onSelectModel,
    collaborationModes,
    selectedCollaborationModeId,
    onSelectCollaborationMode,
    reasoningOptions,
    selectedEffort,
    onSelectEffort,
    selectedServiceTier,
    reasoningSupported,
    accessMode,
    onSelectAccessMode,
    skills,
    plugins,
    onRefreshSkills,
    onRefreshPlugins,
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
    onToggleTerminal,
    onComposerOpenTerminal,
    debugOpen,
    debugEntries,
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    onHideTerminalPanel,
    terminalState,
    onClearDebug,
    onCopyDebug,
    onResizeDebug,
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
    sidebarToggles,
  };

  return {
    primary: buildPrimarySurface(context),
    git: buildGitSurface(context),
    secondary: buildSecondarySurface(context),
  };
}
