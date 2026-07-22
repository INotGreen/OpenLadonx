import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ConversationItem,
  DebugEntry,
  GitHubPullRequest,
  SendMessageResult,
  WorkspaceInfo,
} from "@/types";
import { buildPerFileThreadDiffs } from "@/features/git/utils/perFileThreadDiffs";

type UseMainAppGitStateOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  activeItems: ConversationItem[];
  activeThreadId: string | null;
  activeTab: "home" | "projects" | "chat" | "git" | "log";
  tabletTab: "chat" | "git" | "log";
  isCompact: boolean;
  isTablet: boolean;
  setActiveTab: (tab: "home" | "projects" | "chat" | "git" | "log") => void;
  appSettings: {
    preloadGitDiffs: boolean;
    gitDiffIgnoreWhitespaceChanges: boolean;
    splitChatDiffView: boolean;
    reviewDeliveryMode: "inline" | "detached";
  };
  addDebugEntry: (entry: DebugEntry) => void;
  updateWorkspaceSettings: (
    workspaceId: string,
    settings: Record<string, unknown>,
  ) => Promise<unknown> | unknown;
  commitMessageModelId: string | null;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: {
      model?: string | null;
      effort?: string | null;
      collaborationMode?: Record<string, unknown> | null;
    },
  ) => Promise<void | SendMessageResult>;
};

type GitPanelMode = "diff" | "issues" | "log" | "perFile" | "prs";

type FilePanelMode = "preview";
type GitDiffSource = "commit" | "local" | "perFile" | "pr";

export function useMainAppGitState({
  activeWorkspace,
  activeWorkspaceId,
  activeItems,
  isCompact,
  setActiveTab,
}: UseMainAppGitStateOptions) {
  const activeWorkspaceRef = useRef(activeWorkspace);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const [centerMode, setCenterMode] = useState<"chat" | "diff">("chat");
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
  const [gitPanelMode, setGitPanelMode] = useState<GitPanelMode>("diff");
  const [gitDiffViewStyle, setGitDiffViewStyle] = useState<"split" | "unified">("split");
  const [filePanelMode, setFilePanelMode] = useState<FilePanelMode>("preview");
  const [selectedPullRequest, setSelectedPullRequest] =
    useState<GitHubPullRequest | null>(null);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [diffSource, setDiffSource] = useState<GitDiffSource>("local");
  const [gitRootScanDepth, setGitRootScanDepth] = useState(2);
  const [commitMessage, setCommitMessage] = useState("");
  const [diffScrollRequestId, setDiffScrollRequestId] = useState(0);
  const { groups: perFileDiffGroups, viewerEntries: perFileDiffs } = useMemo(
    () => buildPerFileThreadDiffs(activeItems),
    [activeItems],
  );

  activeWorkspaceRef.current = activeWorkspace;
  activeWorkspaceIdRef.current = activeWorkspaceId;

  const alertError = useCallback((error: unknown) => {
    alert(error instanceof Error ? error.message : String(error));
  }, []);

  const noop = useCallback(() => {}, []);
  const noopAsync = useCallback(async () => {}, []);

  const handleSelectDiff = useCallback((path: string) => {
    setSelectedDiffPath(path);
    setCenterMode("diff");
  }, []);

  const handleSelectPerFileDiff = useCallback(
    (path: string) => {
      setSelectedDiffPath(path);
      setGitPanelMode("perFile");
      setDiffSource("perFile");
      setSelectedCommitSha(null);
      setSelectedPullRequest(null);
      setDiffScrollRequestId((current) => current + 1);
      if (isCompact) {
        setActiveTab("git");
      }
    },
    [isCompact, setActiveTab],
  );

  const handleSelectCommit = useCallback((sha: string) => {
    setSelectedCommitSha(sha);
    setCenterMode("diff");
  }, []);

  const handleActiveDiffPath = useCallback((path: string) => {
    setSelectedDiffPath(path);
  }, []);

  const handleGitPanelModeChange = useCallback((mode: GitPanelMode) => {
    setGitPanelMode(mode);
  }, []);

  const handleCommitMessageChange = useCallback((value: string) => {
    setCommitMessage(value);
  }, []);

  const gitStatus = {
    branchName: null as string | null,
    totalAdditions: 0,
    totalDeletions: 0,
    files: [] as Array<{ path: string }>,
    stagedFiles: [] as Array<{ path: string }>,
    unstagedFiles: [] as Array<{ path: string }>,
    error: "Git UI disabled",
  };

  return {
    activeWorkspaceRef,
    activeWorkspaceIdRef,
    queueGitStatusRefresh: noop,
    alertError,
    centerMode,
    setCenterMode,
    selectedDiffPath,
    setSelectedDiffPath,
    diffScrollRequestId,
    gitPanelMode,
    setGitPanelMode,
    gitDiffViewStyle,
    setGitDiffViewStyle,
    filePanelMode,
    setFilePanelMode,
    selectedPullRequest,
    setSelectedPullRequest,
    selectedCommitSha,
    setSelectedCommitSha,
    diffSource,
    setDiffSource,
    gitStatus,
    refreshGitStatus: noop,
    refreshGitDiffs: noop,
    gitLogEntries: [] as Array<{ sha: string }>,
    gitLogTotal: 0,
    gitLogAhead: 0,
    gitLogBehind: 0,
    gitLogAheadEntries: [] as Array<{ sha: string }>,
    gitLogBehindEntries: [] as Array<{ sha: string }>,
    gitLogUpstream: null as string | null,
    gitLogLoading: false,
    gitLogError: null as string | null,
    refreshGitLog: noop,
    shouldLoadDiffs: false,
    activeDiffs:
      diffSource === "perFile" ? perFileDiffs : ([] as Array<{ path: string }>),
    activeDiffLoading: false,
    activeDiffError: null as string | null,
    perFileDiffGroups,
    handleSelectDiff,
    handleSelectPerFileDiff,
    handleSelectCommit,
    handleActiveDiffPath,
    handleGitPanelModeChange,
    shouldLoadGitHubPanelData: false,
    gitIssues: [] as Array<unknown>,
    gitIssuesTotal: 0,
    gitIssuesLoading: false,
    gitIssuesError: null as string | null,
    gitPullRequests: [] as GitHubPullRequest[],
    gitPullRequestsTotal: 0,
    gitPullRequestsLoading: false,
    gitPullRequestsError: null as string | null,
    gitPullRequestDiffs: [] as Array<unknown>,
    gitPullRequestComments: [] as Array<unknown>,
    gitPullRequestCommentsLoading: false,
    gitPullRequestCommentsError: null as string | null,
    handleGitIssuesChange: noop,
    handleGitPullRequestsChange: noop,
    handleGitPullRequestDiffsChange: noop,
    handleGitPullRequestCommentsChange: noop,
    gitRemoteUrl: null as string | null,
    refreshGitRemote: noop,
    gitRootCandidates: [] as string[],
    gitRootScanLoading: false,
    gitRootScanError: null as string | null,
    gitRootScanDepth,
    gitRootScanHasScanned: false,
    scanGitRoots: noopAsync,
    setGitRootScanDepth,
    branches: [] as Array<{ name: string }>,
    currentBranch: null as string | null,
    isBranchSwitcherEnabled: false,
    handleCheckoutBranch: noopAsync,
    handleCheckoutPullRequest: noopAsync,
    handleCreateBranch: noopAsync,
    handleApplyWorktreeChanges: noopAsync,
    handleCreateGitHubRepo: noopAsync,
    createGitHubRepoLoading: false,
    handleInitGitRepo: noopAsync,
    initGitRepoLoading: false,
    handleRevertAllGitChanges: noopAsync,
    handleRevertGitFile: noopAsync,
    handleStageGitAll: noopAsync,
    handleStageGitFile: noopAsync,
    handleUnstageGitFile: noopAsync,
    worktreeApplyError: null as string | null,
    worktreeApplyLoading: false,
    worktreeApplySuccess: false,
    activeGitRoot: null as string | null,
    handleSetGitRoot: noopAsync,
    handlePickGitRoot: noopAsync,
    fileStatus: "Files",
    commitMessage,
    commitMessageLoading: false,
    commitMessageError: null as string | null,
    commitLoading: false,
    pullLoading: false,
    fetchLoading: false,
    pushLoading: false,
    syncLoading: false,
    commitError: null as string | null,
    pullError: null as string | null,
    fetchError: null as string | null,
    pushError: null as string | null,
    syncError: null as string | null,
    handleCommitMessageChange,
    handleGenerateCommitMessage: noopAsync,
    handleCommit: noopAsync,
    handleCommitAndPush: noopAsync,
    handleCommitAndSync: noopAsync,
    handlePull: noopAsync,
    handleFetch: noopAsync,
    handlePush: noopAsync,
    handleSync: noopAsync,
    isLaunchingPullRequestReview: false,
    lastPullRequestReviewThreadId: null as string | null,
    pullRequestReviewActions: null,
    runPullRequestReview: noopAsync,
  } as any;
}
