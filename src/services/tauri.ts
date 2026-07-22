import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Options as NotificationOptions } from "@tauri-apps/plugin-notification";
import type {
  AppSettings,
  EnvInstallStatus,
  EnvInstallTarget,
  EnvRuntimeStatus,
  AppUpdateDownloadStatus,
  AppUpdatePlatformInfo,
  AppRuntimeDefaults,
  AutomationItem,
  CodexUpdateResult,
  CodexDoctorResult,
  DictationModelStatus,
  DictationSessionState,
  LocalUsageSnapshot,
  PluginMarketItem,
  PluginOption,
  TcpDaemonStatus,
  TailscaleDaemonCommandPreview,
  TailscaleStatus,
  TrayRecentThreadEntry,
  TraySessionUsage,
  WorkspaceInfo,
  AppMention,
  WorkspaceSettings,
} from "../types";
import type {
  GitFileDiff,
  GitFileStatus,
  GitCommitDiff,
  GitHubIssuesResponse,
  GitHubPullRequestComment,
  GitHubPullRequestDiff,
  GitHubPullRequestsResponse,
  GitLogResponse,
  ReviewTarget,
} from "../types";

function isMissingTauriInvokeError(error: unknown) {
  return (
    error instanceof TypeError &&
    (error.message.includes("reading 'invoke'") ||
      error.message.includes("reading \"invoke\""))
  );
}

export async function pickWorkspacePath(): Promise<string | null> {
  const selection = await open({ directory: true, multiple: false });
  if (!selection || Array.isArray(selection)) {
    return null;
  }
  return selection;
}

export async function pickWorkspacePaths(): Promise<string[]> {
  const selection = await open({ directory: true, multiple: true });
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export async function pickAttachmentFiles(): Promise<string[]> {
  const selection = await open({
    directory: false,
    multiple: true,
  });
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export async function pickAttachmentFolders(): Promise<string[]> {
  const selection = await open({
    directory: true,
    multiple: true,
  });
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

const ATTACHMENT_IMAGE_EXTENSIONS = [
  "apng",
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jfif",
  "jpe",
  "jpeg",
  "jpg",
  "jxl",
  "png",
  "pjp",
  "pjpeg",
  "svg",
  "svgz",
  "tif",
  "tiff",
  "webp",
];

export async function pickAttachmentImages(): Promise<string[]> {
  const selection = await open({
    multiple: true,
    filters: [
      {
        name: "Images",
        extensions: ATTACHMENT_IMAGE_EXTENSIONS,
      },
    ],
  });
  if (!selection) {
    return [];
  }
  return Array.isArray(selection) ? selection : [selection];
}

export async function exportMarkdownFile(
  content: string,
  defaultFileName = "plan.md",
): Promise<string | null> {
  const selection = await save({
    title: "Export plan as Markdown",
    defaultPath: defaultFileName,
    filters: [
      {
        name: "Markdown",
        extensions: ["md"],
      },
    ],
  });
  if (!selection) {
    return null;
  }
  await invoke("write_text_file", { path: selection, content });
  return selection;
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  try {
    return await invoke<WorkspaceInfo[]>("list_workspaces");
  } catch (error) {
    if (isMissingTauriInvokeError(error)) {
      // In non-Tauri environments (e.g., Electron/web previews), the invoke
      // bridge may be missing. Treat this as "no workspaces" instead of crashing.
      console.warn("Tauri invoke bridge unavailable; returning empty workspaces list.");
      return [];
    }
    throw error;
  }
}

export async function listDirectoryFiles(path: string): Promise<string[]> {
  return invoke<string[]>("list_directory_files", { path });
}

export async function getCurrentWorkspacePath(): Promise<string> {
  return invoke<string>("current_workspace_path");
}

export async function listAutomations(): Promise<AutomationItem[]> {
  try {
    return await invoke<AutomationItem[]>("automations_list");
  } catch (error) {
    if (isMissingTauriInvokeError(error)) {
      console.warn("Tauri invoke bridge unavailable; returning empty automations list.");
      return [];
    }
    throw error;
  }
}

export async function getCodexConfigPath(): Promise<string> {
  return invoke<string>("get_codex_config_path");
}

export async function installPlugin(pluginName: string): Promise<void> {
  return invoke("install_plugin", { pluginName });
}

export async function uninstallPlugin(pluginName: string): Promise<void> {
  return invoke("uninstall_plugin", { pluginName });
}

export async function getAppRuntimeDefaults(): Promise<AppRuntimeDefaults> {
  return invoke<AppRuntimeDefaults>("get_app_runtime_defaults");
}

export async function writeStartupLog(message: string): Promise<void> {
  return invoke("startup_log_write", { message });
}

export async function relaunchApp(): Promise<void> {
  return invoke("app_relaunch");
}

export async function openWechatAuthWindow(): Promise<void> {
  return invoke("open_wechat_auth_window");
}

export type TextFileResponse = {
  exists: boolean;
  content: string;
  truncated: boolean;
  path: string;
};

export type GlobalAgentsResponse = TextFileResponse;
export type GlobalCodexConfigResponse = TextFileResponse;
export type AgentMdResponse = TextFileResponse;
export type AgentSummary = {
  name: string;
  description: string | null;
  developerInstructions: string | null;
  configFile: string;
  resolvedPath: string;
  managedByApp: boolean;
  fileExists: boolean;
};

export type AgentsSettings = {
  configPath: string;
  multiAgentEnabled: boolean;
  maxThreads: number;
  maxDepth: number;
  agents: AgentSummary[];
};

export type SetAgentsCoreInput = {
  multiAgentEnabled: boolean;
  maxThreads: number;
  maxDepth: number;
};

export type CreateAgentInput = {
  name: string;
  description?: string | null;
  developerInstructions?: string | null;
  template?: "blank" | string | null;
  model?: string | null;
  reasoningEffort?: string | null;
};

export type UpdateAgentInput = {
  originalName: string;
  name: string;
  description?: string | null;
  developerInstructions?: string | null;
  renameManagedFile?: boolean;
};

export type DeleteAgentInput = {
  name: string;
  deleteManagedFile?: boolean;
};

type FileScope = "workspace" | "global";
type FileKind = "agents" | "config";

async function fileRead(
  scope: FileScope,
  kind: FileKind,
  workspaceId?: string,
): Promise<TextFileResponse> {
  return invoke<TextFileResponse>("file_read", { scope, kind, workspaceId });
}

async function fileWrite(
  scope: FileScope,
  kind: FileKind,
  content: string,
  workspaceId?: string,
): Promise<void> {
  return invoke("file_write", { scope, kind, workspaceId, content });
}

export async function readImageAsDataUrl(path: string): Promise<string> {
  return invoke<string>("read_image_as_data_url", { path });
}

export async function saveClipboardImageDataUrl(dataUrl: string): Promise<string> {
  return invoke<string>("save_clipboard_image_data_url", { dataUrl });
}

export interface BinaryFileResponse {
  base64: string;
  mime_type: string;
}

export async function readBinaryFile(
  workspaceId: string,
  relativePath: string,
): Promise<BinaryFileResponse> {
  return invoke<BinaryFileResponse>("read_binary_file", { workspaceId, relativePath });
}

export async function readBinaryFilePath(path: string): Promise<BinaryFileResponse> {
  return invoke<BinaryFileResponse>("read_binary_file_path", { path });
}

export async function readGlobalAgentsMd(): Promise<GlobalAgentsResponse> {
  return fileRead("global", "agents");
}

export async function writeGlobalAgentsMd(content: string): Promise<void> {
  return fileWrite("global", "agents", content);
}

export async function readGlobalCodexConfigToml(): Promise<GlobalCodexConfigResponse> {
  return fileRead("global", "config");
}

export async function writeGlobalCodexConfigToml(content: string): Promise<void> {
  return fileWrite("global", "config", content);
}

export async function getAgentsSettings(): Promise<AgentsSettings> {
  return invoke<AgentsSettings>("get_agents_settings");
}

export async function setAgentsCoreSettings(
  input: SetAgentsCoreInput,
): Promise<AgentsSettings> {
  return invoke<AgentsSettings>("set_agents_core_settings", { input });
}

export async function createAgent(input: CreateAgentInput): Promise<AgentsSettings> {
  return invoke<AgentsSettings>("create_agent", { input });
}

export async function updateAgent(input: UpdateAgentInput): Promise<AgentsSettings> {
  return invoke<AgentsSettings>("update_agent", { input });
}

export async function deleteAgent(input: DeleteAgentInput): Promise<AgentsSettings> {
  return invoke<AgentsSettings>("delete_agent", { input });
}

export async function readAgentConfigToml(agentName: string): Promise<string> {
  return invoke<string>("read_agent_config_toml", { agentName });
}

export async function writeAgentConfigToml(
  agentName: string,
  content: string,
): Promise<void> {
  return invoke("write_agent_config_toml", { agentName, content });
}

export async function writeCodexBaseUrl(baseUrl: string | null): Promise<void> {
  return invoke("write_codex_base_url", { baseUrl });
}

export async function applyCustomResponseApi(
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  return invoke("apply_custom_response_api", { baseUrl, apiKey });
}

export async function applyCustomMessagesApi(
  baseUrl: string,
  apiKey: string,
): Promise<void> {
  return invoke("apply_custom_messages_api", { baseUrl, apiKey });
}

/** 切回「默认」API 来源：用 Ladonx 默认值覆盖 config.toml / auth.json / settings.json。 */
export async function applyDefaultApiCredentials(): Promise<void> {
  return invoke("apply_default_api_credentials");
}

export async function revealCodexConfig(): Promise<string> {
  return invoke<string>("reveal_codex_config");
}

export async function readCodexBaseUrl(): Promise<string | null> {
  return invoke<string | null>("read_codex_base_url");
}

export async function readOpenAiApiKeyEnv(): Promise<string | null> {
  return invoke<string | null>("read_openai_api_key_env");
}

export async function readAnthropicApiKeyEnv(): Promise<string | null> {
  return invoke<string | null>("read_anthropic_api_key_env");
}

export async function syncLadonxAuthEnv(): Promise<void> {
  return invoke("sync_ladonx_auth_env");
}

export async function getConfigModel(workspaceId: string): Promise<string | null> {
  const response = await invoke<{ model?: string | null }>("get_config_model", {
    workspaceId,
  });
  const model = response?.model;
  if (typeof model !== "string") {
    return null;
  }
  const trimmed = model.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function addWorkspace(
  path: string,
  surface?: WorkspaceInfo["settings"]["surface"],
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_workspace", { path, surface });
}

export async function addWorkspaceFromGitUrl(
  url: string,
  destinationPath: string,
  targetFolderName: string | null,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_workspace_from_git_url", {
    url,
    destinationPath,
    targetFolderName,
  });
}

export async function isWorkspacePathDir(path: string): Promise<boolean> {
  return invoke<boolean>("is_workspace_path_dir", { path });
}

export async function readClipboardFilePaths(): Promise<string[]> {
  return invoke<string[]>("clipboard_file_paths");
}

export async function readClipboardImagePath(): Promise<string | null> {
  return invoke<string | null>("clipboard_image_path");
}

export async function addClone(
  sourceWorkspaceId: string,
  copiesFolder: string,
  copyName: string,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_clone", {
    sourceWorkspaceId,
    copiesFolder,
    copyName,
  });
}

export async function addWorktree(
  parentId: string,
  branch: string,
  name: string | null,
  copyAgentsMd = true,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("add_worktree", { parentId, branch, name, copyAgentsMd });
}

export type WorktreeSetupStatus = {
  shouldRun: boolean;
  script: string | null;
};

export async function getWorktreeSetupStatus(
  workspaceId: string,
): Promise<WorktreeSetupStatus> {
  return invoke<WorktreeSetupStatus>("worktree_setup_status", { workspaceId });
}

export async function markWorktreeSetupRan(workspaceId: string): Promise<void> {
  return invoke("worktree_setup_mark_ran", { workspaceId });
}

export async function updateWorkspaceSettings(
  id: string,
  settings: WorkspaceSettings,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("update_workspace_settings", { id, settings });
}

export async function removeWorkspace(id: string): Promise<void> {
  return invoke("remove_workspace", { id });
}

export async function removeWorktree(id: string): Promise<void> {
  return invoke("remove_worktree", { id });
}

export async function renameWorktree(
  id: string,
  branch: string,
): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("rename_worktree", { id, branch });
}

export async function renameWorktreeUpstream(
  id: string,
  oldBranch: string,
  newBranch: string,
): Promise<void> {
  return invoke("rename_worktree_upstream", { id, oldBranch, newBranch });
}

export async function applyWorktreeChanges(workspaceId: string): Promise<void> {
  return invoke("apply_worktree_changes", { workspaceId });
}

export async function openWorkspaceIn(
  path: string,
  options: {
    appName?: string | null;
    command?: string | null;
    args?: string[];
    line?: number | null;
    column?: number | null;
  },
): Promise<void> {
  return invoke("open_workspace_in", {
    path,
    app: options.appName ?? null,
    command: options.command ?? null,
    args: options.args ?? [],
    line: options.line ?? null,
    column: options.column ?? null,
  });
}

export async function getOpenAppIcon(appName: string): Promise<string | null> {
  return invoke<string | null>("get_open_app_icon", { appName });
}

export async function connectWorkspace(id: string): Promise<void> {
  return invoke("connect_workspace", { id });
}

export async function setWorkspaceRuntimeCodexArgs(
  workspaceId: string,
  codexArgs: string | null,
): Promise<{ appliedCodexArgs: string | null; respawned: boolean }> {
  return invoke("set_workspace_runtime_codex_args", {
    workspaceId,
    codexArgs,
  });
}

export async function startThread(
  workspaceId: string,
  accessMode?: "read-only" | "current" | "full-access" | null,
) {
  return invoke<any>("start_thread", { workspaceId, accessMode: accessMode ?? null });
}

export async function forkThread(workspaceId: string, threadId: string) {
  return invoke<any>("fork_thread", { workspaceId, threadId });
}

export async function compactThread(workspaceId: string, threadId: string) {
  return invoke<any>("compact_thread", { workspaceId, threadId });
}

async function normalizeImagesForRpc(images?: string[]): Promise<string[] | null> {
  if (images == null) {
    return null;
  }
  if (images.length === 0) {
    return [];
  }
  return images;
}

export async function sendUserMessage(
  workspaceId: string,
  threadId: string,
  text: string,
  options?: {
    model?: string | null;
    effort?: string | null;
    serviceTier?: "fast" | "flex" | null | undefined;
    accessMode?: "read-only" | "current" | "full-access";
    images?: string[];
    collaborationMode?: Record<string, unknown> | null;
    appMentions?: AppMention[];
  },
) {
  const images = await normalizeImagesForRpc(options?.images);
  const payload: Record<string, unknown> = {
    workspaceId,
    threadId,
    text,
    model: options?.model ?? null,
    effort: options?.effort ?? null,
    accessMode: options?.accessMode ?? null,
    images,
  };
  if (options?.serviceTier !== undefined) {
    payload.serviceTier = options.serviceTier;
  }
  if (options?.collaborationMode) {
    payload.collaborationMode = options.collaborationMode;
  }
  if (options?.appMentions && options.appMentions.length > 0) {
    payload.appMentions = options.appMentions;
  }
  return invoke("send_user_message", payload);
}

export async function interruptTurn(
  workspaceId: string,
  threadId: string,
  turnId: string,
) {
  return invoke("turn_interrupt", { workspaceId, threadId, turnId });
}

export async function steerTurn(
  workspaceId: string,
  threadId: string,
  turnId: string,
  text: string,
  images?: string[],
  appMentions?: AppMention[],
) {
  const normalizedImages = await normalizeImagesForRpc(images);
  const payload: Record<string, unknown> = {
    workspaceId,
    threadId,
    turnId,
    text,
    images: normalizedImages,
  };
  if (appMentions && appMentions.length > 0) {
    payload.appMentions = appMentions;
  }
  return invoke("turn_steer", payload);
}

export async function startReview(
  workspaceId: string,
  threadId: string,
  target: ReviewTarget,
  delivery?: "inline" | "detached",
) {
  const payload: Record<string, unknown> = { workspaceId, threadId, target };
  if (delivery) {
    payload.delivery = delivery;
  }
  return invoke("start_review", payload);
}

export async function respondToServerRequest(
  workspaceId: string,
  requestId: number | string,
  decision: "accept" | "decline",
) {
  return invoke("respond_to_server_request", {
    workspaceId,
    requestId,
    result: { decision },
  });
}

export async function respondToUserInputRequest(
  workspaceId: string,
  requestId: number | string,
  answers: Record<string, { answers: string[] }>,
) {
  return invoke("respond_to_server_request", {
    workspaceId,
    requestId,
    result: { answers },
  });
}

export async function rememberApprovalRule(
  workspaceId: string,
  command: string[],
) {
  return invoke("remember_approval_rule", { workspaceId, command });
}

export async function getGitStatus(workspace_id: string): Promise<{
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
}> {
  return invoke("get_git_status", { workspaceId: workspace_id });
}

export type InitGitRepoResponse =
  | { status: "initialized"; commitError?: string }
  | { status: "already_initialized" }
  | { status: "needs_confirmation"; entryCount: number };

export async function initGitRepo(
  workspaceId: string,
  branch: string,
  force = false,
): Promise<InitGitRepoResponse> {
  return invoke<InitGitRepoResponse>("init_git_repo", { workspaceId, branch, force });
}

export type CreateGitHubRepoResponse =
  | { status: "ok"; repo: string; remoteUrl?: string | null }
  | {
      status: "partial";
      repo: string;
      remoteUrl?: string | null;
      pushError?: string | null;
      defaultBranchError?: string | null;
    };

export async function createGitHubRepo(
  workspaceId: string,
  repo: string,
  visibility: "private" | "public",
  branch?: string | null,
): Promise<CreateGitHubRepoResponse> {
  return invoke<CreateGitHubRepoResponse>("create_github_repo", {
    workspaceId,
    repo,
    visibility,
    branch,
  });
}

export async function listGitRoots(
  workspace_id: string,
  depth: number,
): Promise<string[]> {
  return invoke("list_git_roots", { workspaceId: workspace_id, depth });
}

export async function getGitDiffs(
  workspace_id: string,
): Promise<GitFileDiff[]> {
  return invoke("get_git_diffs", { workspaceId: workspace_id });
}

export async function getGitLog(
  workspace_id: string,
  limit = 40,
): Promise<GitLogResponse> {
  return invoke("get_git_log", { workspaceId: workspace_id, limit });
}

export async function getGitCommitDiff(
  workspace_id: string,
  sha: string,
): Promise<GitCommitDiff[]> {
  return invoke("get_git_commit_diff", { workspaceId: workspace_id, sha });
}

export async function getGitRemote(workspace_id: string): Promise<string | null> {
  return invoke("get_git_remote", { workspaceId: workspace_id });
}

export async function stageGitFile(workspaceId: string, path: string) {
  return invoke("stage_git_file", { workspaceId, path });
}

export async function stageGitAll(workspaceId: string): Promise<void> {
  return invoke("stage_git_all", { workspaceId });
}

export async function unstageGitFile(workspaceId: string, path: string) {
  return invoke("unstage_git_file", { workspaceId, path });
}

export async function revertGitFile(workspaceId: string, path: string) {
  return invoke("revert_git_file", { workspaceId, path });
}

export async function revertGitAll(workspaceId: string) {
  return invoke("revert_git_all", { workspaceId });
}

export async function commitGit(
  workspaceId: string,
  message: string,
): Promise<void> {
  return invoke("commit_git", { workspaceId, message });
}

export async function pushGit(workspaceId: string): Promise<void> {
  return invoke("push_git", { workspaceId });
}

export async function pullGit(workspaceId: string): Promise<void> {
  return invoke("pull_git", { workspaceId });
}

export async function fetchGit(workspaceId: string): Promise<void> {
  return invoke("fetch_git", { workspaceId });
}

export async function syncGit(workspaceId: string): Promise<void> {
  return invoke("sync_git", { workspaceId });
}

export async function getGitHubIssues(
  workspace_id: string,
): Promise<GitHubIssuesResponse> {
  return invoke("get_github_issues", { workspaceId: workspace_id });
}

export async function getGitHubPullRequests(
  workspace_id: string,
): Promise<GitHubPullRequestsResponse> {
  return invoke("get_github_pull_requests", { workspaceId: workspace_id });
}

export async function getGitHubPullRequestDiff(
  workspace_id: string,
  prNumber: number,
): Promise<GitHubPullRequestDiff[]> {
  return invoke("get_github_pull_request_diff", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function getGitHubPullRequestComments(
  workspace_id: string,
  prNumber: number,
): Promise<GitHubPullRequestComment[]> {
  return invoke("get_github_pull_request_comments", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function checkoutGitHubPullRequest(
  workspace_id: string,
  prNumber: number,
): Promise<void> {
  return invoke("checkout_github_pull_request", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function localUsageSnapshot(
  days?: number,
  workspacePath?: string | null,
): Promise<LocalUsageSnapshot> {
  const payload: { days: number; workspacePath?: string } = { days: days ?? 30 };
  if (workspacePath) {
    payload.workspacePath = workspacePath;
  }
  return invoke("local_usage_snapshot", payload);
}

export async function getModelList(workspaceId: string) {
  return invoke<any>("model_list", { workspaceId });
}

export async function getExperimentalFeatureList(
  workspaceId: string,
  cursor?: string | null,
  limit?: number | null,
) {
  return invoke<any>("experimental_feature_list", { workspaceId, cursor, limit });
}

export async function setCodexFeatureFlag(
  featureKey: string,
  enabled: boolean,
): Promise<void> {
  return invoke("set_codex_feature_flag", { featureKey, enabled });
}

export async function generateRunMetadata(workspaceId: string, prompt: string) {
  return invoke<{ title: string; worktreeName: string }>("generate_run_metadata", {
    workspaceId,
    prompt,
  });
}

export async function getCollaborationModes(workspaceId: string) {
  return invoke<any>("collaboration_mode_list", { workspaceId });
}

export async function getAccountRateLimits(workspaceId: string) {
  return invoke<any>("account_rate_limits", { workspaceId });
}

export async function getAccountInfo(workspaceId: string) {
  return invoke<any>("account_read", { workspaceId });
}

export async function getCodexAuthStatus() {
  return invoke<any>("codex_auth_status");
}

export async function loginLadonxAuth(
  account: string,
  password: string,
  apiBaseUrl?: string,
) {
  return invoke<any>("ladonx_auth_login", {
    request: {
      account,
      password,
      apiBaseUrl,
    },
  });
}

export async function loginWechatLadonxAuth(request: {
  attemptId: string;
  inviteCode?: string;
  apiBaseUrl?: string;
}) {
  return invoke<void>("ladonx_auth_wechat_login", { request });
}

export async function cancelWechatLadonxAuth(attemptId: string) {
  return invoke<{ canceled: boolean }>("ladonx_auth_wechat_cancel", {
    request: { attemptId },
  });
}

export async function registerLadonxAuth(request: {
  email: string;
  username: string;
  displayName?: string;
  password: string;
  apiBaseUrl?: string;
}) {
  return invoke<any>("ladonx_auth_register", { request });
}

export async function getLadonxAuthStatus(apiBaseUrl?: string) {
  return invoke<any>("ladonx_auth_status", { apiBaseUrl });
}

export async function logoutLadonxAuth() {
  return invoke<void>("ladonx_auth_logout");
}

export async function testLadonxApiKey(request: {
  baseUrl: string;
  apiKey: string;
  apiType?: string;
  model?: string;
}) {
  return invoke<any>("ladonx_api_key_test", { request });
}

export type UserUsageStatisticsSummary = {
  userId: string;
  accountBalance: number | string;
  planType: string | null;
  membershipExpiresAt: string | null;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalCost: number | string;
  totalDurationMs: number;
  dailyWindowStartedAt: string | null;
  dailyRequests: number;
  dailyInputTokens: number;
  dailyOutputTokens: number;
  dailyCachedTokens: number;
  dailyTotalTokens: number;
  dailyCost: number | string;
  lastModelName: string | null;
  lastUsedAt: string | null;
  updatedAt: string | null;
};

export type UserUsageStatisticsRow = {
  id: number;
  time: string;
  token: string;
  group: string;
  type: string;
  model: string;
  durationMs: number;
  firstTokenMs: number | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | string;
};

export type UserUsageStatisticsResponse = {
  message: string;
  code: number;
  data: {
    summary: UserUsageStatisticsSummary;
    rows: UserUsageStatisticsRow[];
  };
};

export async function getLadonxUserUsageStatistics(
  apiBaseUrl?: string,
  limit?: number,
) {
  return invoke<UserUsageStatisticsResponse>("ladonx_user_usage_statistics", {
    apiBaseUrl,
    limit,
  });
}

export type UserSubscriptionQuota = {
  label: string;
  used: number;
  total: number;
  resetIn: string;
};

export type UserSubscription = {
  id: string;
  planName: string;
  provider: string;
  description: string;
  status: string;
  expireDate: string | null;
  expireLabel: string;
  quotas: UserSubscriptionQuota[];
  canRenew: boolean;
};

export type UserSubscriptionsResponse = {
  message: string;
  code: number;
  data: UserSubscription[];
};

export async function getLadonxUserSubscriptions(
  apiBaseUrl?: string,
) {
  return invoke<UserSubscriptionsResponse>("ladonx_user_subscriptions", {
    apiBaseUrl,
  });
}

export async function runCodexLogin(workspaceId: string) {
  return invoke<{ loginId: string; authUrl: string; raw?: unknown }>("codex_login", {
    workspaceId,
  });
}

export async function cancelCodexLogin(workspaceId: string) {
  return invoke<{ canceled: boolean; status?: string; raw?: unknown }>(
    "codex_login_cancel",
    { workspaceId },
  );
}

export async function getSkillsList(workspaceId: string) {
  return invoke<any>("skills_list", { workspaceId });
}

export async function getAppsList(
  workspaceId: string,
  cursor?: string | null,
  limit?: number | null,
  threadId?: string | null,
) {
  return invoke<any>("apps_list", { workspaceId, cursor, limit, threadId });
}

export async function getPluginsMarketplace() {
  return invoke<PluginMarketItem[]>("plugins_marketplace_list");
}

export async function getConfiguredPlugins() {
  return invoke<PluginOption[]>("configured_plugins_list");
}

export async function getPromptsList(workspaceId: string) {
  return invoke<any>("prompts_list", { workspaceId });
}

export async function getWorkspacePromptsDir(workspaceId: string) {
  return invoke<string>("prompts_workspace_dir", { workspaceId });
}

export async function getGlobalPromptsDir(workspaceId: string) {
  return invoke<string>("prompts_global_dir", { workspaceId });
}

export async function createPrompt(
  workspaceId: string,
  data: {
    scope: "workspace" | "global";
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  },
) {
  return invoke<any>("prompts_create", {
    workspaceId,
    scope: data.scope,
    name: data.name,
    description: data.description ?? null,
    argumentHint: data.argumentHint ?? null,
    content: data.content,
  });
}

export async function updatePrompt(
  workspaceId: string,
  data: {
    path: string;
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  },
) {
  return invoke<any>("prompts_update", {
    workspaceId,
    path: data.path,
    name: data.name,
    description: data.description ?? null,
    argumentHint: data.argumentHint ?? null,
    content: data.content,
  });
}

export async function deletePrompt(workspaceId: string, path: string) {
  return invoke<any>("prompts_delete", { workspaceId, path });
}

export async function movePrompt(
  workspaceId: string,
  data: { path: string; scope: "workspace" | "global" },
) {
  return invoke<any>("prompts_move", {
    workspaceId,
    path: data.path,
    scope: data.scope,
  });
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function isMobileRuntime(): Promise<boolean> {
  return invoke<boolean>("is_mobile_runtime");
}

export async function updateAppSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>("update_app_settings", { settings });
}

export async function tailscaleStatus(): Promise<TailscaleStatus> {
  return invoke<TailscaleStatus>("tailscale_status");
}

export async function tailscaleDaemonCommandPreview(): Promise<TailscaleDaemonCommandPreview> {
  return invoke<TailscaleDaemonCommandPreview>("tailscale_daemon_command_preview");
}

export async function tailscaleDaemonStart(): Promise<TcpDaemonStatus> {
  return invoke<TcpDaemonStatus>("tailscale_daemon_start");
}

export async function tailscaleDaemonStop(): Promise<TcpDaemonStatus> {
  return invoke<TcpDaemonStatus>("tailscale_daemon_stop");
}

export async function tailscaleDaemonStatus(): Promise<TcpDaemonStatus> {
  return invoke<TcpDaemonStatus>("tailscale_daemon_status");
}

type MenuAcceleratorUpdate = {
  id: string;
  accelerator: string | null;
};

export async function setMenuAccelerators(
  updates: MenuAcceleratorUpdate[],
): Promise<void> {
  return invoke("menu_set_accelerators", { updates });
}

export async function runCodexDoctor(
  codexBin: string | null,
  codexArgs: string | null,
): Promise<CodexDoctorResult> {
  return invoke<CodexDoctorResult>("codex_doctor", { codexBin, codexArgs });
}

export async function runCodexUpdate(
  codexBin: string | null,
  codexArgs: string | null,
): Promise<CodexUpdateResult> {
  return invoke<CodexUpdateResult>("codex_update", { codexBin, codexArgs });
}

export async function getWorkspaceFiles(workspaceId: string) {
  return invoke<string[]>("list_workspace_files", { workspaceId });
}

export async function readWorkspaceFile(
  workspaceId: string,
  path: string,
): Promise<{ content: string; truncated: boolean }> {
  return invoke<{ content: string; truncated: boolean }>("read_workspace_file", {
    workspaceId,
    path,
  });
}

export async function readAgentMd(workspaceId: string): Promise<AgentMdResponse> {
  return fileRead("workspace", "agents", workspaceId);
}

export async function writeAgentMd(workspaceId: string, content: string): Promise<void> {
  return fileWrite("workspace", "agents", content, workspaceId);
}

export async function listGitBranches(workspaceId: string) {
  return invoke<any>("list_git_branches", { workspaceId });
}

export async function checkoutGitBranch(workspaceId: string, name: string) {
  return invoke("checkout_git_branch", { workspaceId, name });
}

export async function createGitBranch(workspaceId: string, name: string) {
  return invoke("create_git_branch", { workspaceId, name });
}

function withModelId(modelId?: string | null) {
  return modelId ? { modelId } : {};
}

export async function getDictationModelStatus(
  modelId?: string | null,
): Promise<DictationModelStatus> {
  return invoke<DictationModelStatus>(
    "dictation_model_status",
    withModelId(modelId),
  );
}

export async function downloadDictationModel(
  modelId?: string | null,
): Promise<DictationModelStatus> {
  return invoke<DictationModelStatus>(
    "dictation_download_model",
    withModelId(modelId),
  );
}

export async function cancelDictationDownload(
  modelId?: string | null,
): Promise<DictationModelStatus> {
  return invoke<DictationModelStatus>(
    "dictation_cancel_download",
    withModelId(modelId),
  );
}

export async function getAppUpdatePlatformInfo(): Promise<AppUpdatePlatformInfo> {
  return invoke<AppUpdatePlatformInfo>("app_update_platform_info");
}

export async function fetchAppUpdateManifest(url: string): Promise<{ body: string }> {
  return invoke<{ body: string }>("app_update_fetch_manifest", { url });
}

export async function getAppUpdateDownloadStatus(): Promise<AppUpdateDownloadStatus> {
  return invoke<AppUpdateDownloadStatus>("app_update_download_status");
}

export async function downloadAppUpdate(input: {
  version: string;
  downloadUrl: string;
  fileName: string;
  expectedSha256?: string;
  expectedSize?: number;
}): Promise<AppUpdateDownloadStatus> {
  return invoke<AppUpdateDownloadStatus>("app_update_download", { input });
}

export async function cancelAppUpdateDownload(): Promise<AppUpdateDownloadStatus> {
  return invoke<AppUpdateDownloadStatus>("app_update_cancel_download");
}

export async function installAndRestartAppUpdate(path: string): Promise<void> {
  return invoke("app_update_install_and_restart", { path });
}

export async function getEnvRuntimeStatus(): Promise<EnvRuntimeStatus> {
  return invoke<EnvRuntimeStatus>("env_runtime_status");
}

export async function startEnvInstall(target: EnvInstallTarget): Promise<EnvInstallStatus> {
  return invoke<EnvInstallStatus>("env_install_start", { target });
}

export async function removeDictationModel(
  modelId?: string | null,
): Promise<DictationModelStatus> {
  return invoke<DictationModelStatus>(
    "dictation_remove_model",
    withModelId(modelId),
  );
}

export async function startDictation(
  preferredLanguage: string | null,
): Promise<DictationSessionState> {
  return invoke("dictation_start", { preferredLanguage });
}

export async function requestDictationPermission(): Promise<boolean> {
  return invoke("dictation_request_permission");
}

export async function stopDictation(): Promise<DictationSessionState> {
  return invoke("dictation_stop");
}

export async function cancelDictation(): Promise<DictationSessionState> {
  return invoke("dictation_cancel");
}

export async function openTerminalSession(
  workspaceId: string,
  terminalId: string,
  cols: number,
  rows: number,
): Promise<{ id: string }> {
  return invoke("terminal_open", { workspaceId, terminalId, cols, rows });
}

export async function writeTerminalSession(
  workspaceId: string,
  terminalId: string,
  data: string,
): Promise<void> {
  return invoke("terminal_write", { workspaceId, terminalId, data });
}

export async function resizeTerminalSession(
  workspaceId: string,
  terminalId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { workspaceId, terminalId, cols, rows });
}

export async function closeTerminalSession(
  workspaceId: string,
  terminalId: string,
): Promise<void> {
  return invoke("terminal_close", { workspaceId, terminalId });
}

export type ClaudeCodePromptResponse = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  json: unknown | null;
  events: unknown[];
  resultEvent: unknown | null;
  sessionId: string | null;
  text: string;
};

export type ClaudeCodeStoredChatMessage = {
  id: string;
  role: string;
  text: string;
  rawJson?: unknown | null;
  events?: unknown[];
  resultEvent?: unknown | null;
  stderr?: string | null;
  sessionId?: string | null;
  createdAt: number;
};

export type ClaudeCodeStoredChatSession = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sessionId?: string | null;
  filePath: string;
};

export type ClaudeCodeStoredChats = {
  sessionsByWorkspace: Record<string, ClaudeCodeStoredChatSession[]>;
  messagesBySession: Record<string, ClaudeCodeStoredChatMessage[]>;
  claudeSessionIdByChat: Record<string, string>;
};

export type ClaudeCodePermissionMode =
  | "plan"
  | "default"
  | "bypassPermissions";

export type ClaudeCodeStreamEvent = {
  chatId: string;
  workspaceId: string;
  event: unknown;
  deltaText?: string | null;
  deltaThinking?: string | null;
  sessionId?: string | null;
};

export async function sendClaudeCodePrompt(
  chatId: string,
  workspaceId: string,
  prompt: string,
  sessionId?: string | null,
  model?: string | null,
  permissionMode?: ClaudeCodePermissionMode | null,
): Promise<ClaudeCodePromptResponse> {
  return invoke("claude_code_prompt", {
    chatId,
    workspaceId,
    prompt,
    sessionId,
    model,
    permissionMode,
  });
}

export async function stopClaudeCodePrompt(chatId: string): Promise<boolean> {
  return invoke("claude_code_stop", { chatId });
}

export type ClaudeCodePaths = {
  home: string | null;
  bin: string | null;
};

export async function resolveClaudeCodePaths(): Promise<ClaudeCodePaths> {
  return invoke<ClaudeCodePaths>("claude_code_paths");
}

export async function listClaudeCodeStoredChats(): Promise<ClaudeCodeStoredChats> {
  return invoke("claude_code_list_stored_chats");
}

export async function readClaudeCodeStoredChat(
  chatId: string,
  workspaceId?: string | null,
): Promise<ClaudeCodeStoredChatMessage[]> {
  return invoke("claude_code_read_stored_chat", {
    chatId,
    workspaceId: workspaceId ?? null,
  });
}

export async function deleteClaudeCodeStoredChat(
  chatId: string,
  workspaceId?: string | null,
): Promise<boolean> {
  return invoke("claude_code_delete_stored_chat", {
    chatId,
    workspaceId: workspaceId ?? null,
  });
}

export async function setClaudeCodeStoredChatTitle(
  chatId: string,
  workspaceId: string,
  title: string,
): Promise<void> {
  return invoke("claude_code_set_stored_chat_title", {
    chatId,
    workspaceId,
    title,
  });
}

export async function listThreads(
  workspaceId: string,
  cursor?: string | null,
  limit?: number | null,
  sortKey?: "created_at" | "updated_at" | null,
) {
  return invoke<any>("list_threads", { workspaceId, cursor, limit, sortKey });
}

export async function listMcpServerStatus(
  workspaceId: string,
  cursor?: string | null,
  limit?: number | null,
) {
  return invoke<any>("list_mcp_server_status", { workspaceId, cursor, limit });
}

export async function resumeThread(workspaceId: string, threadId: string) {
  return invoke<any>("resume_thread", { workspaceId, threadId });
}

export async function readThread(workspaceId: string, threadId: string) {
  return invoke<any>("read_thread", { workspaceId, threadId });
}

export async function threadLiveSubscribe(workspaceId: string, threadId: string) {
  return invoke<any>("thread_live_subscribe", { workspaceId, threadId });
}

export async function threadLiveUnsubscribe(workspaceId: string, threadId: string) {
  return invoke<any>("thread_live_unsubscribe", { workspaceId, threadId });
}

export async function archiveThread(workspaceId: string, threadId: string) {
  return invoke<any>("archive_thread", { workspaceId, threadId });
}

export async function setThreadName(
  workspaceId: string,
  threadId: string,
  name: string,
) {
  return invoke<any>("set_thread_name", { workspaceId, threadId, name });
}

export async function setTrayRecentThreads(entries: TrayRecentThreadEntry[]) {
  return invoke<void>("set_tray_recent_threads", { entries });
}

export async function setTraySessionUsage(usage: TraySessionUsage | null) {
  return invoke<void>("set_tray_session_usage", { usage });
}

export async function generateCommitMessage(
  workspaceId: string,
  commitMessageModelId: string | null,
): Promise<string> {
  return invoke("generate_commit_message", { workspaceId, commitMessageModelId });
}

export type GeneratedAgentConfiguration = {
  description: string;
  developerInstructions: string;
};

export async function generateAgentDescription(
  workspaceId: string,
  description: string,
): Promise<GeneratedAgentConfiguration> {
  return invoke("generate_agent_description", { workspaceId, description });
}

export type AppBuildType = "debug" | "release";

export async function getAppBuildType(): Promise<AppBuildType> {
  return invoke<AppBuildType>("app_build_type");
}

export async function sendNotification(
  title: string,
  body: string,
  options?: {
    id?: number;
    group?: string;
    actionTypeId?: string;
    sound?: string;
    autoCancel?: boolean;
    extra?: Record<string, unknown>;
  },
): Promise<void> {
  const macosDebugBuild = await invoke<boolean>("is_macos_debug_build").catch(
    () => false,
  );
  const attemptFallback = async () => {
    try {
      await invoke("send_notification_fallback", { title, body });
      return true;
    } catch (error) {
      console.warn("Notification fallback failed.", { error });
      return false;
    }
  };

  // In dev builds on macOS, the notification plugin can silently fail because
  // the process is not a bundled app. Prefer the native AppleScript fallback.
  if (macosDebugBuild) {
    await attemptFallback();
    return;
  }

  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let permissionGranted = await notification.isPermissionGranted();
    if (!permissionGranted) {
      const permission = await notification.requestPermission();
      permissionGranted = permission === "granted";
      if (!permissionGranted) {
        console.warn("Notification permission not granted.", { permission });
        await attemptFallback();
        return;
      }
    }
    if (permissionGranted) {
      const payload: NotificationOptions = { title, body };
      if (options?.id !== undefined) {
        payload.id = options.id;
      }
      if (options?.group !== undefined) {
        payload.group = options.group;
      }
      if (options?.actionTypeId !== undefined) {
        payload.actionTypeId = options.actionTypeId;
      }
      if (options?.sound !== undefined) {
        payload.sound = options.sound;
      }
      if (options?.autoCancel !== undefined) {
        payload.autoCancel = options.autoCancel;
      }
      if (options?.extra !== undefined) {
        payload.extra = options.extra;
      }
      await notification.sendNotification(payload);
      return;
    }
  } catch (error) {
    console.warn("Notification plugin failed.", { error });
  }

  await attemptFallback();
}
