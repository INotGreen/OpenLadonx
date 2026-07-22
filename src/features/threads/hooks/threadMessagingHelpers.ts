import type {
  AccessMode,
  AppMention,
  ComposerSendIntent,
  RateLimitSnapshot,
  ReviewTarget,
  ServiceTier,
} from "@/types";
import { clampThreadName } from "@threads/utils/threadNaming";
import { formatRelativeTime } from "@utils/time";

type TranslationFunction = (key: string, options?: Record<string, unknown>) => string | object;

export type SendMessageOptions = {
  skipPromptExpansion?: boolean;
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  appMentions?: AppMention[];
  sendIntent?: ComposerSendIntent;
};

type FastCommandAction = "toggle" | "on" | "off" | "status" | "invalid";

type ResolveSendMessageOptionsArgs = {
  options?: SendMessageOptions;
  defaults: {
    accessMode?: AccessMode;
    model?: string | null;
    effort?: string | null;
    serviceTier?: ServiceTier | null | undefined;
    collaborationMode?: Record<string, unknown> | null;
    steerEnabled: boolean;
    isProcessing: boolean;
    activeTurnId: string | null;
  };
};

export type ResolvedSendMessageOptions = {
  resolvedModel?: string | null;
  resolvedEffort?: string | null;
  resolvedServiceTier?: ServiceTier | null | undefined;
  sanitizedCollaborationMode: Record<string, unknown> | null;
  resolvedAccessMode?: AccessMode;
  appMentions: AppMention[];
  sendIntent: ComposerSendIntent;
  shouldSteer: boolean;
  requestMode: "start" | "steer";
};

export type TurnStartPayload = {
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  images?: string[];
  appMentions?: AppMention[];
};

export function buildReviewThreadTitle(
  target: ReviewTarget,
  t?: TranslationFunction,
): string | null {
  const reviewLabel = String(t?.("messages.review") ?? "Review");
  if (target.type === "commit") {
    const shortSha = target.sha.trim().slice(0, 7);
    const title = target.title?.trim() ?? "";
    if (shortSha && title) {
      return clampThreadName(`${reviewLabel} ${shortSha}: ${title}`);
    }
    if (shortSha) {
      return clampThreadName(`${reviewLabel} ${shortSha}`);
    }
    return clampThreadName(String(t?.("messages.reviewCommit") ?? "Review Commit"));
  }
  if (target.type === "baseBranch") {
    return clampThreadName(`${reviewLabel} ${target.branch}`);
  }
  if (target.type === "uncommittedChanges") {
    return String(t?.("messages.reviewWorkingTree") ?? "Review Working Tree");
  }
  return null;
}

export function isStaleSteerTurnError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.includes("no active turn")) {
    return true;
  }
  return normalized.includes("active turn") && normalized.includes("not found");
}

export function parseFastCommand(text: string): FastCommandAction {
  const arg = text.replace(/^\/fast\b/i, "").trim().toLowerCase();
  if (!arg) {
    return "toggle";
  }
  if (arg === "on") {
    return "on";
  }
  if (arg === "off") {
    return "off";
  }
  if (arg === "status") {
    return "status";
  }
  return "invalid";
}

export function resolveSendMessageOptions({
  options,
  defaults,
}: ResolveSendMessageOptionsArgs): ResolvedSendMessageOptions {
  const resolvedModel =
    options?.model !== undefined ? options.model : defaults.model;
  const resolvedEffort =
    options?.effort !== undefined ? options.effort : defaults.effort;
  const resolvedServiceTier =
    options?.serviceTier !== undefined ? options.serviceTier : defaults.serviceTier;
  const resolvedCollaborationMode =
    options?.collaborationMode !== undefined
      ? options.collaborationMode
      : defaults.collaborationMode;
  const sanitizedCollaborationMode =
    resolvedCollaborationMode &&
    typeof resolvedCollaborationMode === "object" &&
    "settings" in resolvedCollaborationMode
      ? resolvedCollaborationMode
      : null;
  const resolvedAccessMode =
    options?.accessMode !== undefined ? options.accessMode : defaults.accessMode;
  const appMentions = options?.appMentions ?? [];
  const sendIntent = options?.sendIntent ?? "default";
  const canSteerCurrentTurn =
    defaults.isProcessing && defaults.steerEnabled && Boolean(defaults.activeTurnId);
  const shouldSteer =
    sendIntent === "steer"
      ? canSteerCurrentTurn
      : sendIntent === "queue"
        ? false
        : canSteerCurrentTurn;

  return {
    resolvedModel,
    resolvedEffort,
    resolvedServiceTier,
    sanitizedCollaborationMode,
    resolvedAccessMode,
    appMentions,
    sendIntent,
    shouldSteer,
    requestMode: shouldSteer ? "steer" : "start",
  };
}

export function buildTurnStartPayload({
  model,
  effort,
  serviceTier,
  collaborationMode,
  accessMode,
  images,
  appMentions,
}: {
  model?: string | null;
  effort?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  images: string[];
  appMentions: AppMention[];
}): TurnStartPayload {
  const payload: TurnStartPayload = {
    model,
    effort,
    collaborationMode,
    accessMode,
    images,
  };
  if (serviceTier !== undefined) {
    payload.serviceTier = serviceTier;
  }
  if (appMentions.length > 0) {
    payload.appMentions = appMentions;
  }
  return payload;
}

function normalizeAttachmentPathLine(path: string) {
  return path.trim();
}

const ATTACHMENT_IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "cur",
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
]);

export function isImageAttachmentPath(path: string) {
  if (path.startsWith("data:image/")) {
    return true;
  }
  if (path.startsWith("data:")) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const withoutQuery = normalized.split(/[?#]/, 1)[0] ?? normalized;
  const lastDot = withoutQuery.lastIndexOf(".");
  if (lastDot < 0) {
    return false;
  }
  return ATTACHMENT_IMAGE_EXTENSIONS.has(withoutQuery.slice(lastDot + 1));
}

export function extractImageAttachments(attachments: string[]): string[] {
  return attachments.filter((path) => {
    const normalizedPath = path.trim();
    return normalizedPath.length > 0 && isImageAttachmentPath(normalizedPath);
  });
}

export function appendAttachmentPathsToText(text: string, attachments: string[]): string {
  const normalizedText = text.trim();
  const attachmentLines = Array.from(
    new Set(
      attachments
        .map((path) => normalizeAttachmentPathLine(path))
        .filter(
          (path) =>
            path.length > 0 &&
            !path.startsWith("data:") &&
            !isImageAttachmentPath(path),
        ),
    ),
  );
  if (attachmentLines.length === 0) {
    return normalizedText;
  }
  const existingLines = new Set(
    normalizedText
      .split(/\r?\n/)
      .map((line) => normalizeAttachmentPathLine(line))
      .filter(Boolean),
  );
  const missingLines = attachmentLines.filter((path) => !existingLines.has(path));
  if (missingLines.length === 0) {
    return normalizedText;
  }
  return normalizedText
    ? `${normalizedText}\n${missingLines.join("\n")}`
    : missingLines.join("\n");
}

function normalizeReset(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function resetLabel(value?: number | null): string | null {
  const resetAt = normalizeReset(value);
  return resetAt ? formatRelativeTime(resetAt) : null;
}

function getCollaborationModeId(
  collaborationMode?: Record<string, unknown> | null,
): string {
  if (
    !collaborationMode ||
    typeof collaborationMode !== "object" ||
    !("settings" in collaborationMode) ||
    !collaborationMode.settings ||
    typeof collaborationMode.settings !== "object" ||
    !("id" in collaborationMode.settings)
  ) {
    return "";
  }
  return String(collaborationMode.settings.id ?? "");
}

export function buildStatusLines({
  model,
  serviceTier,
  effort,
  accessMode,
  collaborationMode,
  rateLimits,
  t,
}: {
  model?: string | null;
  serviceTier?: ServiceTier | null | undefined;
  effort?: string | null;
  accessMode?: AccessMode;
  collaborationMode?: Record<string, unknown> | null;
  rateLimits: RateLimitSnapshot | null;
  t?: TranslationFunction;
}): string[] {
  const onLabel = String(t?.("messages.on") ?? "on");
  const offLabel = String(t?.("messages.off") ?? "off");
  const defaultLabel = String(t?.("messages.default") ?? "default");
  const currentLabel = accessMode ?? "current";

  const lines = [
    String(t?.("messages.sessionStatus") ?? "Session status:"),
    `- ${String(t?.("messages.model") ?? "Model")}: ${model ?? defaultLabel}`,
    `- ${String(t?.("messages.fastMode") ?? "Fast mode")}: ${serviceTier === "fast" ? onLabel : offLabel}`,
    `- ${String(t?.("messages.reasoningEffort") ?? "Reasoning effort")}: ${effort ?? defaultLabel}`,
    `- ${String(t?.("messages.access") ?? "Access")}: ${currentLabel}`,
    `- ${String(t?.("messages.collaboration") ?? "Collaboration")}: ${getCollaborationModeId(collaborationMode) || offLabel}`,
  ];

  const primaryUsed = rateLimits?.primary?.usedPercent;
  const secondaryUsed = rateLimits?.secondary?.usedPercent;

  if (typeof primaryUsed === "number") {
    const reset = resetLabel(rateLimits?.primary?.resetsAt);
    const resetsLabel = String(t?.("messages.resets", { time: reset ?? "" }) ?? `resets ${reset}`);
    lines.push(
      `- ${String(t?.("messages.sessionUsage") ?? "Session usage")}: ${Math.round(primaryUsed)}%${
        reset ? ` (${resetsLabel})` : ""
      }`,
    );
  }
  if (typeof secondaryUsed === "number") {
    const reset = resetLabel(rateLimits?.secondary?.resetsAt);
    const resetsLabel = String(t?.("messages.resets", { time: reset ?? "" }) ?? `resets ${reset}`);
    lines.push(
      `- ${String(t?.("messages.weeklyUsage") ?? "Weekly usage")}: ${Math.round(secondaryUsed)}%${
        reset ? ` (${resetsLabel})` : ""
      }`,
    );
  }

  const credits = rateLimits?.credits ?? null;
  if (credits?.hasCredits) {
    if (credits.unlimited) {
      const unlimitedLabel = String(t?.("messages.unlimited") ?? "unlimited");
      lines.push(`- ${String(t?.("messages.credits") ?? "Credits")}: ${unlimitedLabel}`);
    } else if (credits.balance) {
      lines.push(`- ${String(t?.("messages.credits") ?? "Credits")}: ${credits.balance}`);
    }
  }

  return lines;
}

export function buildMcpStatusLines(
  data: Array<Record<string, unknown>>,
  t?: TranslationFunction,
): string[] {
  const lines: string[] = [String(t?.("messages.mcpTools") ?? "MCP tools:")];
  if (data.length === 0) {
    lines.push(String(t?.("messages.noMcpServersConfigured") ?? "- No MCP servers configured."));
    return lines;
  }

  const servers = [...data].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
  for (const server of servers) {
    const name = String(server.name ?? "unknown");
    const authStatus = server.authStatus ?? server.auth_status ?? null;
    const authLabel =
      typeof authStatus === "string"
        ? authStatus
        : authStatus && typeof authStatus === "object" && "status" in authStatus
          ? String((authStatus as { status?: unknown }).status ?? "")
          : "";
    lines.push(`- ${name}${authLabel ? ` (auth: ${authLabel})` : ""}`);

    const toolsRecord =
      server.tools && typeof server.tools === "object"
        ? (server.tools as Record<string, unknown>)
        : {};
    const prefix = `mcp__${name}__`;
    const toolNames = Object.keys(toolsRecord)
      .map((toolName) =>
        toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName,
      )
      .sort((a, b) => a.localeCompare(b));
    const toolsLabel = String(t?.("messages.tools") ?? "tools");
    const toolsNoneLabel = String(t?.("messages.toolsNone") ?? "tools: none");
    lines.push(
      toolNames.length > 0
        ? `  ${toolsLabel}: ${toolNames.join(", ")}`
        : `  ${toolsNoneLabel}`,
    );

    const resources = Array.isArray(server.resources) ? server.resources.length : 0;
    const templates = Array.isArray(server.resourceTemplates)
      ? server.resourceTemplates.length
      : Array.isArray(server.resource_templates)
        ? server.resource_templates.length
        : 0;
    if (resources > 0 || templates > 0) {
      const resourcesLabel = String(t?.("messages.resources") ?? "resources");
      const templatesLabel = String(t?.("messages.templates") ?? "templates");
      lines.push(`  ${resourcesLabel}: ${resources}, ${templatesLabel}: ${templates}`);
    }
  }

  return lines;
}

export function buildAppsLines(
  data: Array<Record<string, unknown>>,
  t?: TranslationFunction,
): string[] {
  const lines: string[] = [String(t?.("messages.apps") ?? "Apps:")];
  if (data.length === 0) {
    lines.push(String(t?.("messages.noAppsAvailable") ?? "- No apps available."));
    return lines;
  }

  const apps = [...data].sort((a, b) =>
    String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
  for (const app of apps) {
    const name = String(app.name ?? app.id ?? "unknown");
    const appId = String(app.id ?? "");
    const isAccessible = Boolean(app.isAccessible ?? app.is_accessible ?? false);
    const status = isAccessible
      ? String(t?.("messages.connected") ?? "connected")
      : String(t?.("messages.canBeInstalled") ?? "can be installed");
    const description =
      typeof app.description === "string" && app.description.trim().length > 0
        ? app.description.trim()
        : "";
    lines.push(
      `- ${name}${appId ? ` (${appId})` : ""} — ${status}${description ? `: ${description}` : ""}`,
    );

    const installUrl =
      typeof app.installUrl === "string"
        ? app.installUrl
        : typeof app.install_url === "string"
          ? app.install_url
          : "";
    if (!isAccessible && installUrl) {
      const installLabel = String(t?.("messages.install") ?? "install");
      lines.push(`  ${installLabel}: ${installUrl}`);
    }
  }

  return lines;
}
