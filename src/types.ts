export type WorkspaceSurface = "codex" | "claude_code";

export type WorkspaceSettings = {
  sidebarCollapsed: boolean;
  surface?: WorkspaceSurface | null;
  sortOrder?: number | null;
  groupId?: string | null;
  cloneSourceWorkspaceId?: string | null;
  gitRoot?: string | null;
  launchScript?: string | null;
  launchScripts?: LaunchScriptEntry[] | null;
  worktreeSetupScript?: string | null;
  worktreesFolder?: string | null;
};

export type LaunchScriptIconId =
  | "play"
  | "build"
  | "debug"
  | "wrench"
  | "terminal"
  | "code"
  | "server"
  | "database"
  | "package"
  | "test"
  | "lint"
  | "dev"
  | "git"
  | "config"
  | "logs";

export type LaunchScriptEntry = {
  id: string;
  script: string;
  icon: LaunchScriptIconId;
  label?: string | null;
};

export type WorkspaceGroup = {
  id: string;
  name: string;
  sortOrder?: number | null;
  copiesFolder?: string | null;
};

export type WorkspaceKind = "main" | "worktree";

export type WorktreeInfo = {
  branch: string;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  source: WorkspaceSurface;
  connected: boolean;
  kind?: WorkspaceKind;
  parentId?: string | null;
  worktree?: WorktreeInfo | null;
  settings: WorkspaceSettings;
};

export type AutomationItem = {
  id: string;
  title: string;
  owner: string;
  path: string;
};

export type AppServerEvent = {
  workspace_id: string;
  message: Record<string, unknown>;
};

export type TrayRecentThreadEntry = {
  workspaceId: string;
  workspaceLabel: string;
  threadId: string;
  threadLabel: string;
  updatedAt: number;
};

export type TraySessionUsage = {
  sessionLabel: string;
  weeklyLabel: string | null;
};

export type TrayOpenThreadPayload = {
  workspaceId: string;
  threadId: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type CollabAgentRef = {
  threadId: string;
  nickname?: string;
  role?: string;
};

export type CollabAgentStatus = CollabAgentRef & {
  status: string;
};

export type ConversationItem =
  | {
      id: string;
      kind: "message";
      role: "user" | "assistant";
      text: string;
      images?: string[];
      provider?: WorkspaceSurface;
    }
  | {
      id: string;
      kind: "userInput";
      status: "requested" | "answered";
      questions: {
        id: string;
        header: string;
        question: string;
        answers: string[];
      }[];
    }
  | {
      id: string;
      kind: "reasoning";
      summary: string;
      content: string;
      provider?: WorkspaceSurface;
    }
  | { id: string; kind: "diff"; title: string; diff: string; status?: string }
  | { id: string; kind: "review"; state: "started" | "completed"; text: string }
  | {
      id: string;
      kind: "explore";
      status: "exploring" | "explored";
      entries: { kind: "read" | "search" | "list" | "run"; label: string; detail?: string }[];
    }
  | {
      id: string;
      kind: "tool";
      toolType: string;
      title: string;
      detail: string;
      status?: string;
      output?: string;
      durationMs?: number | null;
      preserveCommandOutput?: boolean;
      suppressToolOutput?: boolean;
      changes?: { path: string; kind?: string; diff?: string }[];
      collabSender?: CollabAgentRef;
      collabReceiver?: CollabAgentRef;
      collabReceivers?: CollabAgentRef[];
      collabStatuses?: CollabAgentStatus[];
      plan?: { explanation: string | null; steps: TurnPlanStep[] };
    };

export type ThreadSummary = {
  id: string;
  name: string;
  updatedAt: number;
  createdAt?: number;
  filePath?: string | null;
  modelId?: string | null;
  effort?: string | null;
  isSubagent?: boolean;
  subagentNickname?: string | null;
  subagentRole?: string | null;
};

export type ThreadListSortKey = "created_at" | "updated_at";
export type ThreadListOrganizeMode =
  | "by_project"
  | "by_project_activity"
  | "threads_only";

export type ReviewTarget =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string; title?: string }
  | { type: "custom"; instructions: string };

export type PullRequestReviewIntent =
  | "full"
  | "risks"
  | "tests"
  | "summary"
  | "question";

export type PullRequestReviewAction = {
  id: string;
  label: string;
  intent: PullRequestReviewIntent;
};

export type PullRequestSelectionLine = {
  type: "add" | "del" | "context";
  oldLine: number | null;
  newLine: number | null;
  text: string;
};

export type PullRequestSelectionRange = {
  path: string;
  status: string;
  start: number;
  end: number;
  lines: PullRequestSelectionLine[];
};

export type AccessMode = "read-only" | "current" | "full-access";
export type ServiceTier = "fast" | "flex";
export type BackendMode = "local" | "remote";
export type RemoteBackendProvider = "tcp" | "websocket";
export type RemoteBackendTarget = {
  id: string;
  name: string;
  provider: RemoteBackendProvider;
  host: string;
  token: string | null;
  lastConnectedAtMs?: number | null;
};
export type ThemePreference = "system" | "light" | "dark" | "dim";
export type PersonalityPreference = "friendly" | "pragmatic";
export type FollowUpMessageBehavior = "queue" | "steer";
export type ComposerSendIntent = "default" | "queue" | "steer";
export type SendMessageResult = {
  status: "sent" | "blocked" | "steer_failed";
};

export type ComposerEditorPreset = "default" | "helpful" | "smart";

export type ComposerEditorSettings = {
  preset: ComposerEditorPreset;
  expandFenceOnSpace: boolean;
  expandFenceOnEnter: boolean;
  fenceLanguageTags: boolean;
  fenceWrapSelection: boolean;
  autoWrapPasteMultiline: boolean;
  autoWrapPasteCodeLike: boolean;
  continueListOnShiftEnter: boolean;
};

export type OpenAppTarget = {
  id: string;
  label: string;
  kind: "app" | "command" | "finder";
  appName?: string | null;
  command?: string | null;
  args: string[];
};

export type AppSettings = {
  codexBin: string | null;
  codexArgs: string | null;
  codexApiKey: string | null;
  codexBaseUrl: string | null;
  apiSourceMode: "default" | "custom";
  customResponseApi: CustomApiConfig | null;
  customMessagesApi: CustomApiConfig | null;
  backendMode: BackendMode;
  remoteBackendProvider: RemoteBackendProvider;
  remoteBackendHost: string;
  remoteBackendToken: string | null;
  remoteBackendWebSocketUrl: string | null;
  remoteBackends: RemoteBackendTarget[];
  activeRemoteBackendId: string | null;
  keepDaemonRunningAfterAppClose: boolean;
  defaultAccessMode: AccessMode;
  reviewDeliveryMode: "inline" | "detached";
  composerModelShortcut: string | null;
  composerAccessShortcut: string | null;
  composerReasoningShortcut: string | null;
  composerCollaborationShortcut: string | null;
  interruptShortcut: string | null;
  newAgentShortcut: string | null;
  newWorktreeAgentShortcut: string | null;
  newCloneAgentShortcut: string | null;
  archiveThreadShortcut: string | null;
  toggleProjectsSidebarShortcut: string | null;
  toggleGitSidebarShortcut: string | null;
  branchSwitcherShortcut: string | null;
  toggleDebugPanelShortcut: string | null;
  toggleTerminalShortcut: string | null;
  cycleAgentNextShortcut: string | null;
  cycleAgentPrevShortcut: string | null;
  cycleWorkspaceNextShortcut: string | null;
  cycleWorkspacePrevShortcut: string | null;
  lastComposerModelId: string | null;
  lastComposerReasoningEffort: string | null;
  uiScale: number;
  theme: ThemePreference;
  language: "en" | "zh";
  usageShowRemaining: boolean;
  showMessageFilePath: boolean;
  chatHistoryScrollbackItems: number | null;
  uiFontFamily: string;
  codeFontFamily: string;
  codeFontSize: number;
  notificationSoundsEnabled: boolean;
  systemNotificationsEnabled: boolean;
  subagentSystemNotificationsEnabled: boolean;
  splitChatDiffView: boolean;
  preloadGitDiffs: boolean;
  gitDiffIgnoreWhitespaceChanges: boolean;
  commitMessagePrompt: string;
  commitMessageModelId: string | null;
  collaborationModesEnabled: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: FollowUpMessageBehavior;
  composerFollowUpHintEnabled: boolean;
  pauseQueuedMessagesWhenResponseRequired: boolean;
  unifiedExecEnabled: boolean;
  experimentalAppsEnabled: boolean;
  personality: PersonalityPreference;
  dictationEnabled: boolean;
  dictationModelId: string;
  dictationPreferredLanguage: string | null;
  dictationHoldKey: string | null;
  composerEditorPreset: ComposerEditorPreset;
  composerFenceExpandOnSpace: boolean;
  composerFenceExpandOnEnter: boolean;
  composerFenceLanguageTags: boolean;
  composerFenceWrapSelection: boolean;
  composerFenceAutoWrapPasteMultiline: boolean;
  composerFenceAutoWrapPasteCodeLike: boolean;
  composerListContinuation: boolean;
  composerCodeBlockCopyUseModifier: boolean;
  workspaceGroups: WorkspaceGroup[];
  globalWorktreesFolder: string | null;
  openAppTargets: OpenAppTarget[];
  selectedOpenAppId: string;
};

export type AppRuntimeDefaults = {
  ladonxApiBaseUrl: string;
  codexBaseUrl: string;
  updateApiBaseUrl: string;
  relayHostUrl: string;
  remoteBackendHost: string;
};

export type CustomApiConfig = {
  baseUrl: string;
  apiKey: string;
  models: string[];
};

export type CodexFeatureStage =
  | "under_development"
  | "beta"
  | "stable"
  | "deprecated"
  | "removed";

export type CodexFeature = {
  name: string;
  stage: CodexFeatureStage;
  enabled: boolean;
  defaultEnabled: boolean;
  displayName: string | null;
  description: string | null;
  announcement: string | null;
};

export type TcpDaemonState = "stopped" | "running" | "error";

export type TcpDaemonStatus = {
  state: TcpDaemonState;
  pid: number | null;
  startedAtMs: number | null;
  lastError: string | null;
  listenAddr: string | null;
};

export type TailscaleStatus = {
  installed: boolean;
  running: boolean;
  version: string | null;
  dnsName: string | null;
  hostName: string | null;
  tailnetName: string | null;
  ipv4: string[];
  ipv6: string[];
  suggestedRemoteHost: string | null;
  message: string;
};

export type TailscaleDaemonCommandPreview = {
  command: string;
  daemonPath: string;
  args: string[];
  tokenConfigured: boolean;
};

export type CodexDoctorResult = {
  ok: boolean;
  codexBin: string | null;
  version: string | null;
  appServerOk: boolean;
  details: string | null;
  path: string | null;
  nodeOk: boolean;
  nodeVersion: string | null;
  nodeDetails: string | null;
};

export type CodexUpdateMethod = "brew_formula" | "brew_cask" | "npm" | "unknown";

export type CodexUpdateResult = {
  ok: boolean;
  method: CodexUpdateMethod;
  package: string | null;
  beforeVersion: string | null;
  afterVersion: string | null;
  upgraded: boolean;
  output: string | null;
  details: string | null;
};

export type ApprovalRequest = {
  workspace_id: string;
  request_id: number | string;
  method: string;
  params: Record<string, unknown>;
};

export type RequestUserInputOption = {
  label: string;
  description: string;
};

export type RequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther?: boolean;
  options?: RequestUserInputOption[];
};

export type RequestUserInputParams = {
  thread_id: string;
  turn_id: string;
  item_id: string;
  questions: RequestUserInputQuestion[];
};

export type RequestUserInputRequest = {
  workspace_id: string;
  request_id: number | string;
  params: RequestUserInputParams;
};

export type RequestUserInputAnswer = {
  answers: string[];
};

export type RequestUserInputResponse = {
  answers: Record<string, RequestUserInputAnswer>;
};

export type GitFileStatus = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

export type GitFileDiff = {
  path: string;
  diff: string;
  oldLines?: string[];
  newLines?: string[];
  isBinary?: boolean;
  isImage?: boolean;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
};

export type GitCommitDiff = {
  path: string;
  status: string;
  diff: string;
  oldLines?: string[];
  newLines?: string[];
  isBinary?: boolean;
  isImage?: boolean;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
};

export type GitLogEntry = {
  sha: string;
  summary: string;
  author: string;
  timestamp: number;
};

export type GitLogResponse = {
  total: number;
  entries: GitLogEntry[];
  ahead: number;
  behind: number;
  aheadEntries: GitLogEntry[];
  behindEntries: GitLogEntry[];
  upstream: string | null;
};

export type GitHubIssue = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
};

export type GitHubIssuesResponse = {
  total: number;
  issues: GitHubIssue[];
};

export type GitHubUser = {
  login: string;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  createdAt: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  author: GitHubUser | null;
};

export type GitHubPullRequestsResponse = {
  total: number;
  pullRequests: GitHubPullRequest[];
};

export type GitHubPullRequestDiff = {
  path: string;
  status: string;
  diff: string;
};

export type GitHubPullRequestComment = {
  id: number;
  body: string;
  createdAt: string;
  url: string;
  author: GitHubUser | null;
};

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
};

export type LocalUsageDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  agentTimeMs: number;
  agentRuns: number;
};

export type LocalUsageTotals = {
  last7DaysTokens: number;
  last30DaysTokens: number;
  averageDailyTokens: number;
  cacheHitRatePercent: number;
  peakDay: string | null;
  peakDayTokens: number;
};

export type LocalUsageModel = {
  model: string;
  tokens: number;
  sharePercent: number;
};

export type LocalUsageSnapshot = {
  updatedAt: number;
  days: LocalUsageDay[];
  totals: LocalUsageTotals;
  topModels: LocalUsageModel[];
};

export type TurnPlanStepStatus = "pending" | "inProgress" | "completed";

export type TurnPlanStep = {
  step: string;
  status: TurnPlanStepStatus;
};

export type TurnPlan = {
  turnId: string;
  explanation: string | null;
  steps: TurnPlanStep[];
};

export type ThreadGoal = {
  threadId: string;
  objective: string | null;
  status: string | null;
  tokensUsed?: number | null;
  timeUsedSeconds?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

export type CreditsSnapshot = {
  hasCredits: boolean;
  unlimited: boolean;
  balance: string | null;
};

export type RateLimitSnapshot = {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: CreditsSnapshot | null;
  planType: string | null;
};

export type AccountSnapshot = {
  type: "chatgpt" | "apikey" | "unknown";
  email: string | null;
  planType: string | null;
  requiresOpenaiAuth: boolean | null;
};

export type QueuedMessage = {
  id: string;
  text: string;
  createdAt: number;
  images?: string[];
  appMentions?: AppMention[];
};

export type AppMention = {
  name: string;
  path: string;
};

export type ModelOption = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  provider?: string | null;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
};

export type CollaborationModeOption = {
  id: string;
  label: string;
  mode: string;
  model: string;
  reasoningEffort: string | null;
  developerInstructions: string | null;
  value: Record<string, unknown>;
};

export type SkillOption = {
  name: string;
  path: string;
  description?: string;
  iconDataUrl?: string;
};

export type PluginOption = {
  key: string;
  name: string;
  path: string;
  description?: string;
  iconDataUrl?: string;
  brandColor?: string;
};

export type AppOption = {
  id: string;
  name: string;
  description?: string;
  isAccessible: boolean;
  installUrl?: string | null;
  distributionChannel?: string | null;
};

export type PluginMarketItem = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  shortDescription?: string;
  longDescription?: string;
  category?: string;
  version?: string;
  developerName?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  brandColor?: string;
  iconDataUrl?: string;
  sourceMarketplace: string;
  installationPolicy?: string;
  installed: boolean;
};

export type CustomPromptOption = {
  name: string;
  path: string;
  description?: string;
  argumentHint?: string;
  content: string;
  scope?: "workspace" | "global";
};

export type BranchInfo = {
  name: string;
  lastCommit: number;
};

export type DebugEntry = {
  id: string;
  timestamp: number;
  source: "client" | "server" | "event" | "stderr" | "error";
  label: string;
  payload?: unknown;
};

export type TerminalStatus = "idle" | "connecting" | "ready" | "error";

export type DictationModelState = "missing" | "downloading" | "ready" | "error";

export type DictationDownloadProgress = {
  totalBytes?: number | null;
  downloadedBytes: number;
};

export type DictationModelStatus = {
  state: DictationModelState;
  modelId: string;
  progress?: DictationDownloadProgress | null;
  error?: string | null;
  path?: string | null;
};

export type AppUpdateTargetKey =
  | "mac_amd_64"
  | "mac_arm_64"
  | "win_amd_64"
  | "win_arm_64"
  | "unsupported";

export type AppUpdatePlatformInfo = {
  os: "macos" | "windows" | "linux" | "unknown";
  arch: "x86_64" | "aarch64" | "unknown";
  targetKey: AppUpdateTargetKey;
};

export type AppUpdateDownloadState = "idle" | "downloading" | "downloaded" | "error";

export type AppUpdateDownloadStatus = {
  state: AppUpdateDownloadState;
  version: string | null;
  fileName: string | null;
  path: string | null;
  downloadUrl: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
};

export type EnvInstallTarget = "nodejs" | "codex" | "claude_code";

export type EnvInstallState =
  | "idle"
  | "pending_elevation"
  | "downloading"
  | "installing"
  | "completed"
  | "error"
  | "unsupported";

export type EnvPackageStatus = {
  installed: boolean;
  version: string | null;
  path: string | null;
  command: string | null;
  packageName: string | null;
  sourceUrl: string | null;
  managed: boolean;
  installedAtMs: number | null;
};

export type EnvStatusManifest = {
  version: number;
  updatedAtMs: number;
  platform: string;
  arch: string;
  nodejs: EnvPackageStatus;
  codex: EnvPackageStatus;
  claudeCode: EnvPackageStatus;
};

export type EnvInstallStatus = {
  state: EnvInstallState;
  target: EnvInstallTarget | null;
  progressPercent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  message: string | null;
  error: string | null;
  elevated: boolean;
  startedAtMs: number | null;
  updatedAtMs: number | null;
};

export type EnvRuntimeStatus = {
  manifest: EnvStatusManifest;
  install: EnvInstallStatus;
  envJsonPath: string;
  supported: boolean;
};

export type DictationSessionState = "idle" | "listening" | "processing";

export type DictationEvent =
  | { type: "state"; state: DictationSessionState }
  | { type: "level"; value: number }
  | { type: "transcript"; text: string }
  | { type: "error"; message: string }
  | { type: "canceled"; message: string };

export type DictationTranscript = {
  id: string;
  text: string;
};
