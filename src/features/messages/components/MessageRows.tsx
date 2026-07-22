import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode, Ref } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import Brain from "lucide-react/dist/esm/icons/brain";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Copy from "lucide-react/dist/esm/icons/copy";
import Diff from "lucide-react/dist/esm/icons/diff";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import FileDiffIcon from "lucide-react/dist/esm/icons/file-diff";
import FileText from "lucide-react/dist/esm/icons/file-text";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Image from "lucide-react/dist/esm/icons/image";
import Package from "lucide-react/dist/esm/icons/package";
import Search from "lucide-react/dist/esm/icons/search";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import Users from "lucide-react/dist/esm/icons/users";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import X from "lucide-react/dist/esm/icons/x";
import docIcon from "@/assets/svg-icons/doc.svg";
import docxIcon from "@/assets/svg-icons/docx.svg";
import excelIcon from "@/assets/svg-icons/excel.svg";
import mdIcon from "@/assets/svg-icons/md.svg";
import pdfIcon from "@/assets/svg-icons/pdf.svg";
import pngIcon from "@/assets/svg-icons/png.svg";
import pptIcon from "@/assets/svg-icons/ppt.svg";
import txtIcon from "@/assets/svg-icons/txt.svg";
import {
  exportMarkdownFile,
  getCurrentWorkspacePath,
  isWorkspacePathDir,
  readImageAsDataUrl,
} from "@services/tauri";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { pushErrorToast } from "@services/toasts";
import type { ConversationItem } from "../../../types";
import type { ParsedFileLocation } from "../../../utils/fileLinks";
import { getFileTypeIconUrl, getFolderTypeIconUrl } from "@/utils/fileTypeIcons";
import { isAbsolutePath, joinWorkspacePath, revealInFileManagerLabel } from "../../../utils/platformPaths";
import { PierreDiffBlock } from "../../git/components/PierreDiffBlock";
import {
  describeFileTarget,
  resolveMessageFileHref,
} from "../utils/messageFileLinks";
import {
  MAX_COMMAND_OUTPUT_LINES,
  basename,
  buildToolSummary,
  exploreKindLabel,
  formatDurationMs,
  formatToolStatusLabel,
  normalizeMessageImageSrc,
  resolveMessageAssetPath,
  stripInterruptedTurnMetadata,
  toolNameFromTitle,
  toolStatusTone,
  type MessageImage,
  type ParsedReasoning,
  type StatusTone,
  type ToolSummary,
} from "../utils/messageRenderUtils";
import { resolveMountedWorkspacePath } from "../utils/mountedWorkspacePaths";
import {
  detectShellCommandLanguage,
  getCachedCodeBlockHtml,
  getCachedCommandOutputHtml,
  getFallbackCodeBlockHtml,
  getFallbackCommandOutputHtml,
  highlightCodeBlockHtml,
  highlightCommandOutputHtml,
} from "../utils/shiki";
import { useResolvedAppTheme } from "../utils/useResolvedAppTheme";
import { Markdown } from "./Markdown";
import { isStandaloneMarkdownTable } from "./Markdown";
import chromeIcon from "/assets/material-icons/chrome.svg";

type MarkdownFileLinkProps = {
  showMessageFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
};

type WorkingIndicatorProps = {
  isThinking: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  hasItems: boolean;
  reasoningLabel?: string | null;
  showPollingFetchStatus?: boolean;
  pollingIntervalMs?: number;
};

type MessageRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "message" }>;
  agentFileDiffStatsByPath?: Map<string, DiffStats>;
  codeBlockCopyUseModifier?: boolean;
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
  onOpenCanvas?: () => void;
};

type ReasoningRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "reasoning" }>;
  parsed: ParsedReasoning;
  isExpanded: boolean;
  onToggle: (id: string) => void;
};

type ReviewRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "review" }>;
};

type DiffRowProps = {
  item: Extract<ConversationItem, { kind: "diff" }>;
};

type UserInputRowProps = {
  item: Extract<ConversationItem, { kind: "userInput" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
} & Pick<MarkdownFileLinkProps, "workspacePath">;

type ToolRowProps = MarkdownFileLinkProps & {
  item: Extract<ConversationItem, { kind: "tool" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
};

type ExploreRowProps = {
  item: Extract<ConversationItem, { kind: "explore" }>;
};

type CommandOutputProps = {
  command?: string | null;
  cwd?: string | null;
  output: string;
};

type TerminalHighlightedCodeProps = {
  className: string;
  value: string;
  language?: string | null;
  mode?: "code" | "terminal";
  collapsed?: boolean;
  innerRef?: Ref<HTMLDivElement>;
};

type MessageAttachmentInfo = {
  rawPath: string;
  title: string;
  detail: string;
};

export type DiffStats = { additions: number; deletions: number };

type AgentMessageFileLink = {
  target: ParsedFileLocation;
  diffStats?: DiffStats;
};

type AgentMessageUrlLink = {
  url: string;
  title: string;
  detail: string;
};

type StructuredToolArgs = {
  code: string;
  detail: string;
  title: string;
};

const USER_MESSAGE_COLLAPSE_MAX_HEIGHT = 240;
const COMMAND_HIGHLIGHT_DEBOUNCE_MS = 180;

const USER_INPUT_TOKEN_PATTERN =
  /\[\$([^\]:\s]+):([^\]\s]+)\]\(([^)]+)\)|@'((?:\\.|[^'\\\n])*)'/g;
const EXTENSIONLESS_FILE_NAMES = new Set([
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "procfile",
  "readme",
  "rakefile",
]);

function normalizePathSeparators(path: string) {
  return path.replace(/\\/g, "/");
}

function decodeUserInputFilePathToken(path: string) {
  return path.replace(/\\(['\\])/g, "$1");
}

function getFilePathLabel(path: string) {
  const normalized = normalizePathSeparators(path);
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || path;
}


function expandHomePath(path: string, homePath: string | null) {
  const trimmed = path.trim();
  if (!homePath || !trimmed.includes("~")) {
    return trimmed;
  }
  const normalizedHome = homePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = trimmed.replace(/\\/g, "/");
  if (normalizedPath === "~") {
    return normalizedHome;
  }
  const tildeIndex = normalizedPath.indexOf("~/");
  if (tildeIndex < 0) {
    return trimmed;
  }
  const suffix = normalizedPath.slice(tildeIndex + 2).replace(/^\/+/, "");
  return suffix ? `${normalizedHome}/${suffix}` : normalizedHome;
}

function isLikelyFolderPath(path: string, label: string) {
  const normalized = normalizePathSeparators(path);
  if (/[\\/]$/.test(path) || normalized.endsWith("/")) {
    return true;
  }
  const lowerLabel = label.toLowerCase();
  if (EXTENSIONLESS_FILE_NAMES.has(lowerLabel) || lowerLabel.startsWith(".")) {
    return false;
  }
  return !label.includes(".");
}

function dirname(path: string) {
  const normalized = normalizePathSeparators(path).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index === -1) {
    return "";
  }
  return normalized.slice(0, index);
}

function parseStructuredToolArgs(item: Extract<ConversationItem, { kind: "tool" }>) {
  if (item.toolType !== "mcpToolCall" || !item.detail?.trim()) {
    return null;
  }
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(item.detail) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const code = typeof args.code === "string" ? args.code.trim() : "";
  if (!code) {
    return null;
  }

  const title = typeof args.title === "string" ? args.title.trim() : "";
  const details: string[] = [];
  const timeoutMs = args.timeout_ms ?? args.timeoutMs;
  if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs)) {
    details.push(`timeout ${formatDurationMs(timeoutMs)}`);
  } else if (typeof timeoutMs === "string" && timeoutMs.trim()) {
    details.push(`timeout ${timeoutMs.trim()}ms`);
  }

  return {
    code,
    detail: details.join(" · "),
    title,
  } satisfies StructuredToolArgs;
}

function buildFencedCodeBlock(language: string, code: string) {
  const longestFence = code.match(/`{3,}/g)?.reduce(
    (longest, fence) => Math.max(longest, fence.length),
    0,
  ) ?? 2;
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language}\n${code}\n${fence}`;
}

async function resolveUserInputNodePath(path: string, workspacePath?: string | null) {
  const trimmed = path.trim();
  const homePath = await homeDir().catch(() => null);
  const homeExpandedPath = expandHomePath(trimmed, homePath);
  const resolvedWorkspacePath =
    workspacePath?.trim() || (await getCurrentWorkspacePath().catch(() => ""));
  if (!resolvedWorkspacePath) {
    return homeExpandedPath;
  }
  const mountedWorkspacePath = resolveMountedWorkspacePath(
    homeExpandedPath,
    resolvedWorkspacePath,
  );
  if (mountedWorkspacePath) {
    return mountedWorkspacePath;
  }
  if (isAbsolutePath(homeExpandedPath)) {
    return homeExpandedPath;
  }
  return joinWorkspacePath(resolvedWorkspacePath, homeExpandedPath);
}

async function openUserInputNodeDirectory(
  path: string,
  options: { treatAsFolder: boolean; workspacePath?: string | null },
) {
  const resolvedPath = await resolveUserInputNodePath(path, options.workspacePath);
  const targetPath = options.treatAsFolder ? resolvedPath : dirname(resolvedPath) || resolvedPath;
  try {
    if (options.treatAsFolder) {
      await openPath(targetPath);
      return;
    }
    await revealItemInDir(resolvedPath);
  } catch (error) {
    console.error("Failed to open user input node directory", {
      path,
      resolvedPath,
      targetPath,
      error,
    });
  }
}

const UserInputInlineTokens = memo(function UserInputInlineTokens({
  value,
  workspacePath,
}: {
  value: string;
  workspacePath?: string | null;
}) {
  const content = useMemo<ReactNode[]>(() => {
    const nodes: ReactNode[] = [];
    let cursor = 0;
    USER_INPUT_TOKEN_PATTERN.lastIndex = 0;
    for (
      let match = USER_INPUT_TOKEN_PATTERN.exec(value);
      match;
      match = USER_INPUT_TOKEN_PATTERN.exec(value)
    ) {
      if (match.index > cursor) {
        nodes.push(value.slice(cursor, match.index));
      }
      if (match[1] && match[3]) {
        nodes.push(
          <span
            key={`skill-${match.index}-${match[3]}`}
            className="composer-skill-node-shell"
          >
            <span
              className="composer-skill-node"
              title={match[3]}
              onClick={() => {
                void openUserInputNodeDirectory(match[3], {
                  treatAsFolder: false,
                  workspacePath,
                });
              }}
            >
              <span className="composer-skill-node-prefix">
                <Package
                  className="composer-skill-node-icon"
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span>{match[1]}</span>
              </span>
            </span>
          </span>,
        );
      } else if (match[4]) {
        const filePath = decodeUserInputFilePathToken(match[4]);
        const label = getFilePathLabel(filePath);
        const isFolder = isLikelyFolderPath(filePath, label);
        const iconUrl = isFolder
          ? getFolderTypeIconUrl(filePath)
          : getFileTypeIconUrl(filePath);
        nodes.push(
          <span
            key={`file-${match.index}-${filePath}`}
            className="composer-skill-node-shell"
          >
            <span
              className="composer-file-path-node"
              title={filePath}
              onClick={() => {
                void openUserInputNodeDirectory(filePath, {
                  treatAsFolder: isFolder,
                  workspacePath,
                });
              }}
            >
              <span className="composer-file-path-node-prefix">
                <img
                  className="composer-file-path-node-icon"
                  src={iconUrl}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                />
                <span>{label}</span>
              </span>
            </span>
          </span>,
        );
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < value.length) {
      nodes.push(value.slice(cursor));
    }
    return nodes.length > 0 ? nodes : [value];
  }, [value, workspacePath]);

  return <>{content}</>;
});

function hasInlineToken(value: string) {
  USER_INPUT_TOKEN_PATTERN.lastIndex = 0;
  return USER_INPUT_TOKEN_PATTERN.test(value);
}

const InlineTokenText = memo(function InlineTokenText({
  value,
  workspacePath,
  className,
  enableCollapse = false,
}: {
  value: string;
  workspacePath?: string | null;
  className?: string;
  enableCollapse?: boolean;
}) {
  const { t } = useI18nSafe();
  const lines = useMemo(() => value.split("\n"), [value]);
  const [isCollapsed, setIsCollapsed] = useState(enableCollapse);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsCollapsed(enableCollapse);
  }, [enableCollapse, value]);

  useEffect(() => {
    if (!enableCollapse) {
      setIsCollapsible(false);
      return;
    }
    const node = contentRef.current;
    if (!node) {
      return;
    }

    const measure = () => {
      const nextIsCollapsible = node.scrollHeight > USER_MESSAGE_COLLAPSE_MAX_HEIGHT + 4;
      setIsCollapsible(nextIsCollapsible);
      if (!nextIsCollapsible) {
        setIsCollapsed(false);
      }
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [enableCollapse, lines]);

  return (
    <div
      className={[
        className,
        enableCollapse ? "markdown-collapsible" : "",
        isCollapsible ? "is-collapsible" : "",
        isCollapsible && isCollapsed ? "is-collapsed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div ref={contentRef} className="markdown-collapsible-content">
        {lines.map((line, index) => (
          <span key={`line-${index}`}>
            <UserInputInlineTokens value={line} workspacePath={workspacePath} />
            {index < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </div>
      {isCollapsible ? (
        <button
          type="button"
          className="markdown-collapse-toggle"
          onClick={() => setIsCollapsed((current) => !current)}
        >
          {isCollapsed
            ? String(t("messages.codex.expandOutput"))
            : String(t("messages.codex.collapseOutput"))}
          <ChevronDown
            size={14}
            className={isCollapsed ? "markdown-collapse-toggle-icon" : "markdown-collapse-toggle-icon is-expanded"}
          />
        </button>
      ) : null}
    </div>
  );
});

const TerminalIcon = memo(function TerminalIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <rect
        x="1.5"
        y="3.5"
        width="15"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5 8L7 9.5L5 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 11H12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
});

const MESSAGE_IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "pjpeg",
  "pjp",
  "gif",
  "webp",
  "bmp",
  "ico",
  "cur",
  "tif",
  "tiff",
  "heic",
  "heif",
  "jxl",
  "svg",
  "svgz",
]);
const MESSAGE_VIDEO_EXTENSIONS = new Set([
  "m4v",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogv",
  "webm",
]);
const MATERIAL_FOLDER_ICON_URL = "/assets/material-icons/folder.svg";
const INTERNAL_IMAGE_MARKER_PATTERN = /<image\b(?=[^>]*\bname=)(?=[^>]*\bpath=)[^>]*>/i;
const INTERNAL_IMAGE_MARKER_PATH_PATTERN =
  /<image\b(?=[^>]*\bname=)(?=[^>]*\bpath=)[^>]*\bpath=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/i;
const MARKDOWN_FILE_LINK_PATTERN = /!?\[[^\]\n]*]\(([^)\n]+)\)/g;

function messageAttachmentExtension(path: string) {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const withoutQuery = normalized.split(/[?#]/, 1)[0] ?? normalized;
  const lastDot = withoutQuery.lastIndexOf(".");
  return lastDot >= 0 ? withoutQuery.slice(lastDot + 1) : "";
}

function isMessageImageAttachment(path: string) {
  if (path.startsWith("data:image/")) {
    return true;
  }
  if (path.startsWith("data:")) {
    return false;
  }
  return MESSAGE_IMAGE_EXTENSIONS.has(messageAttachmentExtension(path));
}

function isMessageVideoAttachment(path: string) {
  if (path.startsWith("data:")) {
    return false;
  }
  return MESSAGE_VIDEO_EXTENSIONS.has(messageAttachmentExtension(path));
}

function isInternalImageMarker(value: string) {
  const trimmed = value.trim();
  return INTERNAL_IMAGE_MARKER_PATTERN.test(trimmed) || /^<\/image>\s*$/i.test(trimmed);
}

function pathFromInternalImageMarker(value: string) {
  const match = value.trim().match(INTERNAL_IMAGE_MARKER_PATH_PATTERN);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function normalizeMessageVideoSrc(path: string, workspacePath?: string | null) {
  const resolvedPath = resolveMessageAssetPath(path, workspacePath);
  if (!resolvedPath) {
    return "";
  }
  if (resolvedPath.startsWith("http://") || resolvedPath.startsWith("https://")) {
    return resolvedPath;
  }
  try {
    return convertFileSrc(resolvedPath);
  } catch {
    return "";
  }
}

function isDirectoryAttachmentHint(path: string) {
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return false;
  }
  return /[\\/]$/.test(path);
}

function messageAttachmentIconSrc(path: string, isDirectory = false) {
  if (isDirectory) {
    return MATERIAL_FOLDER_ICON_URL;
  }
  const ext = messageAttachmentExtension(path);
  if (path.startsWith("data:image/") || MESSAGE_IMAGE_EXTENSIONS.has(ext)) {
    return pngIcon;
  }
  if (ext === "pdf") {
    return pdfIcon;
  }
  if (ext === "docx") {
    return docxIcon;
  }
  if (ext === "doc") {
    return docIcon;
  }
  if (["xlsx", "xls", "csv"].includes(ext)) {
    return excelIcon;
  }
  if (["pptx", "ppt"].includes(ext)) {
    return pptIcon;
  }
  if (ext === "md") {
    return mdIcon;
  }
  return txtIcon;
}

function normalizeMarkdownLinkHref(href: string) {
  return href.trim().replace(/^<|>$/g, "");
}

function isExternalHttpUrl(value: string) {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function collectAgentMessageUrlLinks(text: string): AgentMessageUrlLink[] {
  const links: AgentMessageUrlLink[] = [];
  const seen = new Set<string>();
  MARKDOWN_FILE_LINK_PATTERN.lastIndex = 0;
  for (
    let match = MARKDOWN_FILE_LINK_PATTERN.exec(text);
    match;
    match = MARKDOWN_FILE_LINK_PATTERN.exec(text)
  ) {
    const url = normalizeMarkdownLinkHref(match[1] ?? "");
    if (!isExternalHttpUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    let title = "Open link";
    try {
      const parsed = new URL(url);
      title = parsed.hostname.replace(/^www\./i, "") || title;
    } catch {
      title = url;
    }
    links.push({
      url,
      title,
      detail: url,
    });
  }
  return links;
}

function collectAdjacentDiffStats(text: string, cursor: number) {
  const nextContent = text.slice(cursor);
  const match = nextContent.match(/^\s*```(?:diff|patch)\b[^\n]*\n([\s\S]*?)\n```/i);
  if (!match) {
    return undefined;
  }
  const stats = countInlineDiffStats(match[1] ?? "");
  return stats.additions === 0 && stats.deletions === 0 ? undefined : stats;
}

function resolveAgentFileDiffStats(
  target: ParsedFileLocation,
  workspacePath: string | null | undefined,
  statsByPath?: Map<string, DiffStats>,
) {
  if (!statsByPath) {
    return undefined;
  }
  const normalizedPath = normalizePathSeparators(target.path);
  const directStats = statsByPath.get(normalizedPath);
  if (directStats) {
    return directStats;
  }
  if (!workspacePath || isAbsolutePath(normalizedPath)) {
    return undefined;
  }
  return statsByPath.get(normalizePathSeparators(joinWorkspacePath(workspacePath, normalizedPath)));
}

function collectAgentMessageFileLinks(
  text: string,
  workspacePath?: string | null,
  statsByPath?: Map<string, DiffStats>,
): AgentMessageFileLink[] {
  const links: AgentMessageFileLink[] = [];
  const seen = new Set<string>();
  MARKDOWN_FILE_LINK_PATTERN.lastIndex = 0;
  for (
    let match = MARKDOWN_FILE_LINK_PATTERN.exec(text);
    match;
    match = MARKDOWN_FILE_LINK_PATTERN.exec(text)
  ) {
    const target = resolveMessageFileHref(
      normalizeMarkdownLinkHref(match[1] ?? ""),
      workspacePath,
    );
    if (!target) {
      continue;
    }
    const key = `${target.path}:${target.line ?? ""}:${target.column ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    links.push({
      target,
      diffStats:
        resolveAgentFileDiffStats(target, workspacePath, statsByPath) ??
        collectAdjacentDiffStats(text, MARKDOWN_FILE_LINK_PATTERN.lastIndex),
    });
  }
  return links;
}

function resolveAgentMessageFilePath(path: string, workspacePath?: string | null) {
  if (workspacePath && !isAbsolutePath(path)) {
    return joinWorkspacePath(workspacePath, path);
  }
  return path;
}

function relativeAgentMessagePath(path: string, workspacePath?: string | null) {
  const normalizedPath = normalizePathSeparators(path);
  const normalizedWorkspace = normalizePathSeparators(workspacePath ?? "").replace(/\/+$/, "");
  if (!normalizedWorkspace || !normalizedPath.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedPath;
  }
  return normalizedPath.slice(normalizedWorkspace.length + 1);
}

function AgentMessageFileName({
  fileName,
  path,
  workspacePath,
}: {
  fileName: string;
  path: string;
  workspacePath?: string | null;
}) {
  const relativePath = relativeAgentMessagePath(path, workspacePath);
  const normalizedName = normalizePathSeparators(fileName);
  const prefix = relativePath.endsWith(normalizedName)
    ? relativePath.slice(0, -normalizedName.length)
    : "";
  return (
    <>
      {prefix ? <span className="agent-message-file-card-path-prefix">{prefix}</span> : null}
      <span className="agent-message-file-card-name">{fileName}</span>
    </>
  );
}

function messageAttachmentTitle(path: string, index: number) {
  if (path.startsWith("data:")) {
    return `Pasted image ${index + 1}`;
  }
  if (isMessageImageAttachment(path) && (path.startsWith("http://") || path.startsWith("https://"))) {
    return `Remote image ${index + 1}`;
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : `Attachment ${index + 1}`;
}

function messageAttachmentDetail(path: string) {
  if (path.startsWith("data:")) {
    return "Clipboard image";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const normalized = path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

function normalizeAttachmentText(value: string) {
  return value
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/^localhost\//i, "/")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\\/g, "/");
}

function stripStandaloneAttachmentLines(text: string, attachments: MessageAttachmentInfo[]) {
  if (attachments.length === 0) {
    return text;
  }
  const attachmentPaths = new Set(
    attachments
      .map((attachment) => normalizeAttachmentText(attachment.rawPath))
      .filter(Boolean),
  );
  if (attachmentPaths.size === 0) {
    return text;
  }
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = normalizeAttachmentText(line);
      return !attachmentPaths.has(trimmed);
    })
    .join("\n")
    .trim();
}

function stripSharedIndent(value: string) {
  const lines = value.split("\n");
  let minIndent = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^[ \t]+/);
    const indent = match ? match[0].length : 0;
    minIndent = Math.min(minIndent, indent);
    if (minIndent === 0) {
      break;
    }
  }

  if (!Number.isFinite(minIndent) || minIndent <= 0) {
    return value;
  }

  return lines
    .map((line) => {
      if (!line.trim()) {
        return "";
      }
      return line.replace(new RegExp(`^[ \\t]{0,${minIndent}}`), "");
    })
    .join("\n");
}

const MessageAttachmentList = memo(function MessageAttachmentList({
  attachments,
  onPreviewFile,
  workspacePath,
}: {
  attachments: MessageAttachmentInfo[];
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
  workspacePath?: string | null;
}) {
  const [directoryMap, setDirectoryMap] = useState<Record<string, boolean>>({});
  const videoSrcCacheRef = useRef(new Map<string, string>());
  const [videoLightbox, setVideoLightbox] = useState<{ src: string; title: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const localOnlyPaths = attachments
      .map((attachment) => attachment.rawPath)
      .filter(
        (path) =>
          path &&
          !path.startsWith("data:") &&
          !path.startsWith("http://") &&
          !path.startsWith("https://"),
      );
    const unresolvedPaths = Array.from(
      new Set(localOnlyPaths.filter((path) => !(path in directoryMap))),
    );
    if (unresolvedPaths.length === 0) {
      return undefined;
    }
    void Promise.all(
      unresolvedPaths.map(async (path) => {
        try {
          return [path, await isWorkspacePathDir(path)] as const;
        } catch {
          return [path, isDirectoryAttachmentHint(path)] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }
      setDirectoryMap((current) => {
        const next = { ...current };
        for (const [path, isDir] of entries) {
          next[path] = isDir;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [attachments, directoryMap]);

  const resolveCachedVideoSrc = useCallback((path: string) => {
    const cacheKey = `${workspacePath ?? ""}::${path}`;
    const cached = videoSrcCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const resolvedSrc = normalizeMessageVideoSrc(path, workspacePath);
    if (resolvedSrc) {
      videoSrcCacheRef.current.set(cacheKey, resolvedSrc);
    }
    return resolvedSrc;
  }, [workspacePath]);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="message-attachment-list" role="list">
      {attachments.map((attachment, index) => {
        const isDirectory =
          directoryMap[attachment.rawPath] ?? isDirectoryAttachmentHint(attachment.rawPath);
        const iconSrc = messageAttachmentIconSrc(attachment.rawPath, isDirectory);
        const previewPath = resolveMessageAssetPath(attachment.rawPath, workspacePath);
        const videoSrc =
          !isDirectory && isMessageVideoAttachment(previewPath || attachment.rawPath)
            ? resolveCachedVideoSrc(attachment.rawPath)
            : "";
        const content = (
          <>
            <span className="message-attachment-icon" aria-hidden>
              <img src={iconSrc} alt="" />
            </span>
            <span className="message-attachment-text">
              <span className="message-attachment-title">{attachment.title}</span>
              {attachment.detail ? (
                <span className="message-attachment-detail">{attachment.detail}</span>
              ) : null}
            </span>
          </>
        );
        const key = `${attachment.rawPath}-${index}`;
        if (videoSrc) {
          return (
            <button
              key={key}
              type="button"
              className="message-attachment-item"
              onClick={() => {
                setVideoLightbox({
                  src: videoSrc,
                  title: attachment.title,
                });
              }}
              title={attachment.rawPath}
            >
              {content}
            </button>
          );
        }
        if (onPreviewFile) {
          return (
            <button
              key={key}
              type="button"
              className="message-attachment-item"
              onClick={() => {
                const resolvedPreviewPath = previewPath || attachment.rawPath;
                if (!isDirectory && isMessageVideoAttachment(resolvedPreviewPath)) {
                  setVideoLightbox({
                    src: resolvedPreviewPath,
                    title: attachment.title,
                  });
                  return;
                }
                onPreviewFile(
                  resolvedPreviewPath,
                  isDirectory ? "folder" : "file",
                );
              }}
              title={attachment.rawPath}
            >
              {content}
            </button>
          );
        }
        return (
          <span key={key} className="message-attachment-item" title={attachment.rawPath}>
            {content}
          </span>
        );
      })}
      {videoLightbox ? (
        <VideoLightbox
          src={videoLightbox.src}
          title={videoLightbox.title}
          onClose={() => setVideoLightbox(null)}
        />
      ) : null}
    </div>
  );
});

const MessageImageGrid = memo(function MessageImageGrid({
  images,
  onOpen,
  hasText,
}: {
  images: MessageImage[];
  onOpen: (index: number) => void;
  hasText: boolean;
}) {
  return (
    <div
      className={`message-image-grid${hasText ? " message-image-grid--with-text" : ""}`}
      role="list"
    >
      {images.map((image, index) => (
        <button
          key={`${image.src}-${index}`}
          type="button"
          className="message-image-thumb"
          onClick={() => onOpen(index)}
          aria-label={`Open image ${index + 1}`}
        >
          <MessageImageElement image={image} />
        </button>
      ))}
    </div>
  );
});

const MessageImageElement = memo(function MessageImageElement({
  image,
  className,
}: {
  image: MessageImage;
  className?: string;
}) {
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [trackedSrc, setTrackedSrc] = useState(image.src);
  if (image.src !== trackedSrc) {
    setTrackedSrc(image.src);
    if (fallbackSrc !== null) setFallbackSrc(null);
  }

  const handleError = useCallback(() => {
    if (
      fallbackSrc !== null ||
      !image.sourcePath ||
      image.sourcePath.startsWith("data:") ||
      image.sourcePath.startsWith("http://") ||
      image.sourcePath.startsWith("https://")
    ) {
      return;
    }
    void readImageAsDataUrl(image.sourcePath)
      .then((dataUrl) => {
        if (dataUrl) {
          setFallbackSrc(dataUrl);
        }
      })
      .catch(() => {
        // Keep the original src if the fallback read also fails.
      });
  }, [fallbackSrc, image.sourcePath]);

  return (
    <img
      src={fallbackSrc ?? image.src}
      alt={image.label}
      loading="lazy"
      decoding="async"
      className={className}
      onError={handleError}
    />
  );
});

const AgentMessageFileCards = memo(function AgentMessageFileCards({
  links,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onPreviewFile,
  workspacePath,
}: {
  links: AgentMessageFileLink[];
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: MouseEvent, path: ParsedFileLocation) => void;
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
  workspacePath?: string | null;
}) {
  const { t } = useI18nSafe();
  const handleOpen = useCallback((path: ParsedFileLocation) => {
    if (onPreviewFile) {
      const probePath = resolveAgentMessageFilePath(path.path, workspacePath);
      void isWorkspacePathDir(probePath).then(
        (isDirectory) => onPreviewFile(path.path, isDirectory ? "folder" : "file"),
        () => onPreviewFile(path.path, "file"),
      );
      return;
    }
    onOpenFileLink?.(path);
  }, [onOpenFileLink, onPreviewFile, workspacePath]);

  const handleReveal = useCallback(async (path: ParsedFileLocation) => {
    const resolvedPath = resolveAgentMessageFilePath(path.path, workspacePath);
    try {
      if (await isWorkspacePathDir(resolvedPath)) {
        await openPath(resolvedPath);
        return;
      }
      await revealItemInDir(resolvedPath);
    } catch (error) {
      console.warn("Failed to reveal agent message file", { path: path.path, resolvedPath, error });
    }
  }, [workspacePath]);

  if (links.length === 0) {
    return null;
  }

  const isSummaryView = links.length > 2;
  const imageLinks = links.filter(({ target }) => isMessageImageAttachment(target.path));
  const fileLinks = links.filter(({ target }) => !isMessageImageAttachment(target.path));
  const individualLinks = isSummaryView ? imageLinks : links;
  const summaryLinks = isSummaryView ? fileLinks : [];
  const visibleImageLinks = isSummaryView ? imageLinks : [];
  const revealLabel = revealInFileManagerLabel();

  return (
    <>
      {individualLinks.length > 0 ? (
        <div
          className={`agent-message-file-card-list${visibleImageLinks.length > 0 ? " agent-message-file-card-list-images" : ""}`}
        >
          {individualLinks.map(({ target, diffStats }) => {
            const { fileName, parentPath } = describeFileTarget(target, workspacePath);
            const isDirectory = isLikelyFolderPath(target.path, fileName);
            const iconUrl = isDirectory
              ? getFolderTypeIconUrl(target.path)
              : getFileTypeIconUrl(target.path);
            return (
              <div
                key={`${target.path}:${target.line ?? ""}:${target.column ?? ""}`}
                className="agent-message-file-card agent-message-file-card-image"
                role="group"
              >
                <button
                  type="button"
                  className="agent-message-file-card-main"
                  title={target.path}
                  onClick={() => handleOpen(target)}
                  onContextMenu={(event) => {
                    if (!onOpenFileLinkMenu) {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenFileLinkMenu(event, target);
                  }}
                >
                  <span className="agent-message-file-card-icon" aria-hidden>
                    <img src={iconUrl} alt="" aria-hidden loading="lazy" decoding="async" />
                  </span>
                  <span className="agent-message-file-card-copy">
                    <span className="agent-message-file-card-title">
                      <span className="agent-message-file-card-action">
                        {String(t("messages.codex.filesEdited", { count: 1 }))}
                      </span>
                      <span className="agent-message-file-card-name">{fileName}</span>
                      {diffStats ? (
                        <DiffStatsInline
                          additions={diffStats.additions}
                          deletions={diffStats.deletions}
                        />
                      ) : null}
                    </span>
                    {parentPath ? (
                      <span className="agent-message-file-card-path">{parentPath}</span>
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="agent-message-file-card-open-button icon-button ghost"
                  title={revealLabel}
                  aria-label={revealLabel}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleReveal(target);
                  }}
                >
                  <FolderOpen size={14} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {summaryLinks.length > 0 ? (
        <div className="agent-message-file-card-list">
          <div className="agent-message-file-card agent-message-file-card-summary" role="group">
            <div className="agent-message-file-card-summary-header">
              <span className="agent-message-file-card-icon" aria-hidden>
                <FileDiffIcon className="agent-message-file-card-summary-icon" aria-hidden />
              </span>
              <span className="agent-message-file-card-copy">
                <span className="agent-message-file-card-title">
                  <span className="agent-message-file-card-action">
                    {String(t("messages.codex.filesEditedCount", { count: summaryLinks.length }))}
                  </span>
                </span>
              </span>
            </div>
            <div className="agent-message-file-card-summary-list">
              {summaryLinks.map(({ target, diffStats }) => {
                const { fileName } = describeFileTarget(target, workspacePath);
                return (
                  <div
                    key={`${target.path}:${target.line ?? ""}:${target.column ?? ""}`}
                    className="agent-message-file-card-summary-row"
                  >
                    <button
                      type="button"
                      className="agent-message-file-card-summary-link"
                      title={target.path}
                      onClick={() => handleOpen(target)}
                      onContextMenu={(event) => {
                        if (!onOpenFileLinkMenu) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenFileLinkMenu(event, target);
                      }}
                    >
                      <span className="agent-message-file-card-summary-name">
                        <AgentMessageFileName fileName={fileName} path={target.path} workspacePath={workspacePath} />
                      </span>
                      {diffStats ? (
                        <DiffStatsInline
                          additions={diffStats.additions}
                          deletions={diffStats.deletions}
                        />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="agent-message-file-card-open-button icon-button ghost"
                      title={revealLabel}
                      aria-label={revealLabel}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleReveal(target);
                      }}
                    >
                      <FolderOpen size={14} aria-hidden />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
});

const AgentMessageUrlCards = memo(function AgentMessageUrlCards({
  links,
  onPreviewFile,
}: {
  links: AgentMessageUrlLink[];
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
}) {
  const { t } = useI18nSafe();
  if (links.length === 0) {
    return null;
  }

  const handlePreview = (url: string) => {
    if (onPreviewFile) {
      onPreviewFile(`browser:${url}`, "file");
      return;
    }
    void openUrl(url);
  };

  return (
    <div className="agent-message-file-card-list">
      {links.map((link) => (
        <div key={link.url} className="agent-message-file-card agent-message-file-card-url" role="group">
          <button
            type="button"
            className="agent-message-file-card-main"
            title={link.url}
            onClick={() => {
              handlePreview(link.url);
            }}
          >
            <span className="agent-message-file-card-icon" aria-hidden>
              <img src={chromeIcon} alt="" aria-hidden loading="lazy" decoding="async" />
            </span>
            <span className="agent-message-file-card-copy">
              <span className="agent-message-file-card-title">
                <span className="agent-message-file-card-action">{String(t("messages.link.openLink"))}</span>
                <span className="agent-message-file-card-name">{link.title}</span>
              </span>
              <span className="agent-message-file-card-path">{link.detail}</span>
            </span>
          </button>
          <button
            type="button"
            className="agent-message-file-card-open-button icon-button ghost"
            title={String(t("messages.link.openInBrowser"))}
            aria-label={String(t("messages.link.openInBrowser"))}
            onClick={(event) => {
              event.stopPropagation();
              void openUrl(link.url);
            }}
          >
            <ExternalLink size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
});

export const ImageLightbox = memo(function ImageLightbox({
  images,
  activeIndex,
  onClose,
}: {
  images: MessageImage[];
  activeIndex: number;
  onClose: () => void;
}) {
  const activeImage = images[activeIndex];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!activeImage) {
    return null;
  }

  return createPortal(
    <div
      className="message-image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="message-image-lightbox-content"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="message-image-lightbox-close"
          onClick={onClose}
          aria-label="Close image preview"
        >
          <X size={16} aria-hidden />
        </button>
        <MessageImageElement image={activeImage} className="message-image-lightbox-image" />
      </div>
    </div>,
    document.body,
  );
});

export const VideoLightbox = memo(function VideoLightbox({
  src,
  title,
  onClose,
}: {
  src: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!src) {
    return null;
  }

  return createPortal(
    <div
      className="message-image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="message-image-lightbox-content message-video-lightbox-content"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="message-image-lightbox-close"
          onClick={onClose}
          aria-label="Close video preview"
        >
          <X size={16} aria-hidden />
        </button>
        <video
          src={src}
          controls
          autoPlay
          preload="metadata"
          className="message-video-lightbox-video"
          title={title}
        />
      </div>
    </div>,
    document.body,
  );
});

const CommandOutput = memo(function CommandOutput({
  command = null,
  cwd = null,
  output,
}: CommandOutputProps) {
  const deferredOutput = useDeferredValue(output);
  const copyTimeoutRef = useRef<number | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const displayCommand = useMemo(() => {
    if (typeof command === "string" && command.length > 0) {
      return command;
    }
    return cwd ?? "";
  }, [command, cwd]);
  const outputText = useMemo(() => {
    if (!deferredOutput) {
      return "";
    }
    let startIndex = 0;
    let lineBreaks = 0;
    for (let index = deferredOutput.length - 1; index >= 0; index -= 1) {
      if (deferredOutput.charCodeAt(index) !== 10) {
        continue;
      }
      lineBreaks += 1;
      if (lineBreaks >= MAX_COMMAND_OUTPUT_LINES) {
        startIndex = index + 1;
        break;
      }
    }
    return stripSharedIndent(deferredOutput.slice(startIndex).replace(/\r\n/g, "\n")).trimEnd();
  }, [deferredOutput]);
  const hasOutput = Boolean(outputText);

  useLayoutEffect(() => {
    const outputElement = outputRef.current;
    if (!outputElement) {
      return;
    }
    const nextIsCollapsible = outputElement.scrollHeight > 296;
    setIsCollapsible(nextIsCollapsible);
    setIsCollapsed(nextIsCollapsible);
  }, [outputText]);

  const clipboardValue = useMemo(() => {
    return [displayCommand, outputText].filter(Boolean).join("\n\n");
  }, [displayCommand, outputText]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!clipboardValue) {
      return;
    }
    try {
      await navigator.clipboard.writeText(clipboardValue);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      // Clipboard can be unavailable in restricted contexts.
    }
  }, [clipboardValue]);

  if (!displayCommand && !hasOutput) {
    return null;
  }

  return (
    <div className="claudecode-command-card" role="log" aria-live="polite">
      <div className="claudecode-command-card-header">
        <div className="claudecode-command-card-title">Shell</div>
        <button
          type="button"
          className={`claudecode-command-card-copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy terminal output"}
          title={copied ? "Copied" : "Copy terminal output"}
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        </button>
      </div>
      <div className="claudecode-command-card-body">
        {displayCommand ? (
          <div className="claudecode-command-card-command">
            <TerminalHighlightedCode
              className="claudecode-command-card-command-text"
              value={`$ ${displayCommand}`}
              language={detectShellCommandLanguage(displayCommand)}
              mode="code"
            />
          </div>
        ) : null}
        {hasOutput ? (
          <>
            <TerminalHighlightedCode
              innerRef={outputRef}
              className={`claudecode-terminal-pre${isCollapsed ? " is-collapsed" : ""}`}
              value={outputText}
              mode="terminal"
            />
            {isCollapsible ? (
              <button
                type="button"
                className="claudecode-collapse-toggle"
                onClick={() => setIsCollapsed((current) => !current)}
              >
                {isCollapsed ? "展开" : "折叠"}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {/* <div className="claudecode-command-card-footer">
        <span
          className={`claudecode-command-card-status${isRunning ? " is-running" : ""}`}
        >
          <Check size={15} aria-hidden />
          <span>{isRunning ? "Running" : "Success"}</span>
        </span>
      </div> */}
    </div>
  );
});

const TerminalHighlightedCode = memo(function TerminalHighlightedCode({
  className,
  value,
  language,
  mode = "terminal",
  collapsed = false,
  innerRef,
}: TerminalHighlightedCodeProps) {
  const theme = useResolvedAppTheme();
  const [highlightedHtml, setHighlightedHtml] = useState(() => {
    if (mode === "terminal") {
      return getCachedCommandOutputHtml(value) || getFallbackCommandOutputHtml(value);
    }
    return getCachedCodeBlockHtml(value, language) || getFallbackCodeBlockHtml(value);
  });

  useEffect(() => {
    const cachedHtml = mode === "terminal"
      ? getCachedCommandOutputHtml(value)
      : getCachedCodeBlockHtml(value, language);
    if (cachedHtml) {
      setHighlightedHtml(cachedHtml);
      return undefined;
    }
    setHighlightedHtml(mode === "terminal" ? getFallbackCommandOutputHtml(value) : getFallbackCodeBlockHtml(value));
    let isActive = true;
    const highlightTimeout = window.setTimeout(() => {
      const promise = mode === "terminal"
        ? highlightCommandOutputHtml(value)
        : highlightCodeBlockHtml(value, language);
      void promise.then((html) => {
        if (isActive) {
          setHighlightedHtml(html);
        }
      });
    }, COMMAND_HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(highlightTimeout);
    };
  }, [language, mode, theme, value]);

  return (
    <div
      ref={innerRef}
      className={`${className}${collapsed ? " is-collapsed" : ""}`}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
});

function toolIconForSummary(
  item: Extract<ConversationItem, { kind: "tool" }>,
  summary: ToolSummary,
) {
  if (item.toolType === "commandExecution") {
    return Terminal;
  }
  if (item.toolType === "fileChange") {
    return FileDiffIcon;
  }
  if (item.toolType === "webSearch") {
    return Search;
  }
  if (item.toolType === "imageView") {
    return Image;
  }
  if (item.toolType === "collabToolCall") {
    return Users;
  }

  const label = summary.label.toLowerCase();
  if (label === "read") {
    return FileText;
  }
  if (label === "searched" || label === "searching") {
    return Search;
  }
  if (label === "wrote" || label === "edited") {
    return FileDiffIcon;
  }

  const toolName = toolNameFromTitle(item.title).toLowerCase();
  const title = item.title.toLowerCase();
  if (toolName.includes("diff") || title.includes("diff")) {
    return Diff;
  }

  return Wrench;
}

function buildPlanExportFileName(itemId: string) {
  const normalized = itemId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!normalized) {
    return "plan.md";
  }
  return normalized.startsWith("plan-") ? `${normalized}.md` : `plan-${normalized}.md`;
}

export function countInlineDiffStats(diff: string): DiffStats {
  let additions = 0;
  let deletions = 0;
  let lineStart = 0;

  for (let index = 0; index <= diff.length; index += 1) {
    if (index < diff.length && diff.charCodeAt(index) !== 10) {
      continue;
    }
    let lineEnd = index;
    if (lineEnd > lineStart && diff.charCodeAt(lineEnd - 1) === 13) {
      lineEnd -= 1;
    }
    if (lineEnd <= lineStart) {
      lineStart = index + 1;
      continue;
    }
    const firstChar = diff.charCodeAt(lineStart);
    if (firstChar === 43 && !diff.startsWith("+++", lineStart)) {
      additions += 1;
    } else if (firstChar === 45 && !diff.startsWith("---", lineStart)) {
      deletions += 1;
    }
    lineStart = index + 1;
  }

  return { additions, deletions };
}

function mergeInlineDiffStats(
  stats: Array<{ additions: number; deletions: number }>,
) {
  let additions = 0;
  let deletions = 0;
  for (const entry of stats) {
    additions += entry.additions;
    deletions += entry.deletions;
  }
  return { additions, deletions };
}

export function AnimatedDiffStat({
  className,
  prefix,
  value,
}: {
  className: string;
  prefix: "+" | "-";
  value: number;
}) {
  return (
    <span className={`${className} is-visible`} aria-hidden={false}>
      {`${prefix}${value}`}
    </span>
  );
}

function DiffStatsInline({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions === 0 && deletions === 0) {
    return null;
  }
  return (
    <span
      className="tool-inline-diff-stats"
      aria-label={`+${additions} -${deletions}`}
    >
      <AnimatedDiffStat
        className="tool-inline-diff-add"
        prefix="+"
        value={additions}
      />
      <AnimatedDiffStat
        className="tool-inline-diff-del"
        prefix="-"
        value={deletions}
      />
    </span>
  );
}

export const WorkingIndicator = memo(function WorkingIndicator({
  isThinking,
  processingStartedAt = null,
  lastDurationMs = null,
  hasItems,
  reasoningLabel: _reasoningLabel = null,
  showPollingFetchStatus = false,
  pollingIntervalMs = 12000,
}: WorkingIndicatorProps) {
  const { t } = useI18nSafe();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pollCountdownSeconds, setPollCountdownSeconds] = useState(() =>
    Math.max(1, Math.ceil(pollingIntervalMs / 1000)),
  );

  useEffect(() => {
    if (!isThinking || !processingStartedAt) {
      setElapsedMs(0);
      return undefined;
    }
    setElapsedMs(Date.now() - processingStartedAt);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - processingStartedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isThinking, processingStartedAt]);

  useEffect(() => {
    if (!showPollingFetchStatus || isThinking) {
      return undefined;
    }
    const intervalSeconds = Math.max(1, Math.ceil(pollingIntervalMs / 1000));
    setPollCountdownSeconds(intervalSeconds);
    const timer = window.setInterval(() => {
      setPollCountdownSeconds((previous) =>
        previous <= 1 ? intervalSeconds : previous - 1,
      );
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [isThinking, pollingIntervalMs, showPollingFetchStatus]);

  return (
    <>
      {isThinking && (
        <div className="working">
          <span className="working-spinner" aria-hidden />
          <div className="working-timer">
            <span className="working-timer-clock">{formatDurationMs(elapsedMs)}</span>
          </div>
          <span className="working-text">{ "Working…"}</span>
        </div>
      )}
      {!isThinking && lastDurationMs !== null && hasItems && (
        <div className="turn-complete" aria-live="polite">
          <span className="turn-complete-line" aria-hidden />
          <span className="turn-complete-label">
            {showPollingFetchStatus
              ? String(t("messages.newMessageWillBeFetchedIn", { seconds: pollCountdownSeconds }))
              : String(t("messages.doneIn", { duration: formatDurationMs(lastDurationMs) }))}
          </span>
          <span className="turn-complete-line" aria-hidden />
        </div>
      )}
    </>
  );
});

export const MessageRow = memo(function MessageRow({
  item,
  agentFileDiffStatsByPath,
  codeBlockCopyUseModifier,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onPreviewFile,
}: MessageRowProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const visibleImagePaths = useMemo(() => {
    if (!item.images || item.images.length === 0) {
      return [];
    }
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const image of item.images) {
      const rawPath = image.trim();
      if (!rawPath || /^<\/image>\s*$/i.test(rawPath)) {
        continue;
      }
      const visiblePath = pathFromInternalImageMarker(rawPath) || rawPath;
      if (isInternalImageMarker(rawPath) && !visiblePath) {
        continue;
      }
      const resolvedPath = resolveMessageAssetPath(visiblePath, workspacePath);
      const key = (resolvedPath || visiblePath).replace(/\\/g, "/");
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      paths.push(visiblePath);
    }
    return paths;
  }, [item.images, workspacePath]);
  const attachmentItems = useMemo(() => {
    if (item.role !== "user" || visibleImagePaths.length === 0) {
      return [];
    }
    return visibleImagePaths
      .map((path, index) => {
        const rawPath = path.trim();
        if (!rawPath || isMessageImageAttachment(rawPath)) {
          return null;
        }
        return {
          rawPath,
          title: messageAttachmentTitle(rawPath, index),
          detail: messageAttachmentDetail(rawPath),
        };
      })
      .filter(Boolean) as MessageAttachmentInfo[];
  }, [item.role, visibleImagePaths]);
  const displayText = useMemo(() => {
    const sanitizedText = stripInterruptedTurnMetadata(item.text);
    if (item.role !== "user") {
      return sanitizedText;
    }
    return stripStandaloneAttachmentLines(sanitizedText, attachmentItems);
  }, [attachmentItems, item.role, item.text]);
  const hasText = displayText.trim().length > 0;
  const hasUserInlineTokens = useMemo(
    () => item.role === "user" && hasText && hasInlineToken(displayText),
    [displayText, hasText, item.role],
  );
  const agentFileLinks = useMemo(
    () =>
      item.role === "assistant"
        ? collectAgentMessageFileLinks(displayText, workspacePath, agentFileDiffStatsByPath)
        : [],
    [agentFileDiffStatsByPath, displayText, item.role, workspacePath],
  );
  const agentUrlLinks = useMemo(
    () => (item.role === "assistant" ? collectAgentMessageUrlLinks(displayText) : []),
    [displayText, item.role],
  );
  const userClipboardValue = item.role === "user" ? displayText.trim() : "";
  const imageItems = useMemo(() => {
    if (visibleImagePaths.length === 0) {
      return [];
    }
    return visibleImagePaths
      .map((image, index) => {
        if (!isMessageImageAttachment(image.trim())) {
          return null;
        }
        const normalizedSrc = normalizeMessageImageSrc(image, workspacePath);
        if (!normalizedSrc) {
          return null;
        }
        return {
          src: normalizedSrc,
          label: `Image ${index + 1}`,
          sourcePath: resolveMessageAssetPath(image, workspacePath),
        };
      })
      .filter(Boolean) as MessageImage[];
  }, [visibleImagePaths, workspacePath]);
  const showUserMessagePreviews = true;
  const isTableOnlyAssistantMessage =
    item.role === "assistant" &&
    hasText &&
    imageItems.length === 0 &&
    isStandaloneMarkdownTable(item.text);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyUserMessage = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!userClipboardValue) {
      return;
    }
    try {
      await navigator.clipboard.writeText(userClipboardValue);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      // Clipboard can be unavailable in restricted contexts.
    }
  }, [userClipboardValue]);
  const handleOpenImage = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);
  const handleCloseLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  return (
    <div className={`message ${item.role}`}>
      <div className={`message-content-stack${item.role === "user" ? " message-content-stack-user" : ""}`}>
        {showUserMessagePreviews && imageItems.length > 0 && (
          <MessageImageGrid
            images={imageItems}
            onOpen={handleOpenImage}
            hasText={hasText}
          />
        )}
        {showUserMessagePreviews && attachmentItems.length > 0 && (
          <MessageAttachmentList
            attachments={attachmentItems}
            onPreviewFile={onPreviewFile}
            workspacePath={workspacePath}
          />
        )}
        {hasText && (
          <div
            className={`bubble message-bubble${isTableOnlyAssistantMessage ? " message-bubble-table-only" : ""}`}
          >
            {hasUserInlineTokens ? (
              <InlineTokenText
                value={displayText}
                workspacePath={workspacePath}
                className="markdown user-inline-token-markdown"
                enableCollapse
              />
            ) : (
              <Markdown
                value={displayText}
                className="markdown"
                codeBlockStyle="message"
                codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                enableCollapse={item.role === "user"}
                completeUnclosedCodeFences={item.role === "assistant" && item.provider === "claude_code"}
                normalizeTightHeadings={item.role === "assistant" && item.provider === "claude_code"}
                enableRichLinks={item.role !== "user"}
                showFilePath={showMessageFilePath}
                workspacePath={workspacePath}
                onOpenFileLink={onOpenFileLink}
                onOpenFileLinkMenu={onOpenFileLinkMenu}
                onOpenThreadLink={onOpenThreadLink}
                onPreviewFile={onPreviewFile}
              />
            )}
            {agentFileLinks.length > 0 ? (
              <AgentMessageFileCards
                links={agentFileLinks}
                onOpenFileLink={onOpenFileLink}
                onOpenFileLinkMenu={onOpenFileLinkMenu}
                onPreviewFile={onPreviewFile}
                workspacePath={workspacePath}
              />
            ) : null}
            {agentUrlLinks.length > 0 ? (
              <AgentMessageUrlCards links={agentUrlLinks} onPreviewFile={onPreviewFile} />
            ) : null}
            {item.role === "user" && userClipboardValue ? (
              <button
                type="button"
                className={`message-user-copy-button${copied ? " is-copied" : ""}`}
                onClick={handleCopyUserMessage}
                aria-label={copied ? "Copied" : "Copy message"}
                title={copied ? "Copied" : "Copy message"}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
               
              </button>
            ) : null}
          </div>
        )}
        {lightboxIndex !== null && imageItems.length > 0 && (
          <ImageLightbox
            images={imageItems}
            activeIndex={lightboxIndex}
            onClose={handleCloseLightbox}
          />
        )}
      </div>
    </div>
  );
});

export const ReasoningRow = memo(function ReasoningRow({
  item,
  parsed,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: ReasoningRowProps) {
  const { summaryTitle, bodyText, hasBody } = parsed;
  const reasoningTone: StatusTone = hasBody ? "completed" : "processing";
  const ReasoningChevron = isExpanded ? ChevronDown : ChevronRight;
  return (
    <div className={`tool-inline reasoning-inline ${isExpanded ? "tool-inline-expanded" : ""}`}>
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label="Toggle reasoning details"
      />
      <div className="tool-inline-content">
        <button
          type="button"
          className="tool-inline-summary tool-inline-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          {hasBody ? (
            <span className="tool-inline-chevron" aria-hidden>
              <ReasoningChevron size={16} />
            </span>
          ) : null}
          <Brain
            className={`tool-inline-icon ${reasoningTone}`}
            size={16}
            aria-hidden
          />
          <span className="tool-inline-value">{summaryTitle}</span>
        </button>
        {hasBody && isExpanded && (
          <Markdown
            value={bodyText}
            className="reasoning-inline-detail markdown"
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
      </div>
    </div>
  );
});

export const ReviewRow = memo(function ReviewRow({
  item,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
}: ReviewRowProps) {
  const title = item.state === "started" ? "Review started" : "Review completed";
  return (
    <div className="item-card review">
      <div className="review-header">
        <span className="review-title">{title}</span>
        <span
          className={`review-badge ${item.state === "started" ? "active" : "done"}`}
        >
          Review
        </span>
      </div>
      {item.text && (
        <Markdown
          value={item.text}
          className="item-text markdown"
          showFilePath={showMessageFilePath}
          workspacePath={workspacePath}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
          onOpenThreadLink={onOpenThreadLink}
        />
      )}
    </div>
  );
});

export const DiffRow = memo(function DiffRow({ item }: DiffRowProps) {
  return (
    <div className="item-card diff">
      <div className="diff-header">
        <span className="diff-title">{item.title}</span>
        {item.status && <span className="item-status">{item.status}</span>}
      </div>
      <div className="diff-viewer-output">
        <PierreDiffBlock diff={item.diff} displayPath={item.title} defaultExpanded />
      </div>
    </div>
  );
});

export const UserInputRow = memo(function UserInputRow({
  item,
  isExpanded,
  onToggle,
  workspacePath,
}: UserInputRowProps) {
  const first = item.questions[0];
  const previewQuestion =
    first?.question?.trim() || first?.header?.trim() || "Input requested";
  const firstAnswer = first?.answers[0]?.trim() || "No answer provided";
  const previewAnswer =
    first && first.answers.length > 1
      ? `${firstAnswer} +${first.answers.length - 1}`
      : firstAnswer;
  const extraQuestions = Math.max(0, item.questions.length - 1);
  const isAnswered = item.status === "answered";

  return (
    <div className={`tool-inline user-input-inline ${isExpanded ? "tool-inline-expanded" : ""}`}>
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label="Toggle answered input details"
      />
      <div className="tool-inline-content">
        <button
          type="button"
          className="tool-inline-summary tool-inline-toggle"
          onClick={() => onToggle(item.id)}
          aria-expanded={isExpanded}
        >
          <Check className={`tool-inline-icon ${isAnswered ? "completed" : ""}`} size={16} aria-hidden />
          <span className="tool-inline-label">{isAnswered ? "answered:" : "input requested:"}</span>
          <span className="tool-inline-value user-input-inline-preview">
            {previewQuestion}{isAnswered ? `: ${previewAnswer}` : ""}
            {extraQuestions > 0 ? ` +${extraQuestions} more` : ""}
          </span>
        </button>
        {isExpanded && (
          <div className="user-input-inline-details">
            {item.questions.map((question, index) => {
              const title = question.question || question.header || `Question ${index + 1}`;
              return (
                <div
                  key={`${question.id}-${index}`}
                  className="user-input-inline-entry"
                >
                  <div className="user-input-inline-question">{title}</div>
                  {question.answers.length > 0 ? (
                    <div className="user-input-inline-answers">
                      {question.answers.map((answer, answerIndex) => (
                        <div
                          key={`${question.id}-answer-${answerIndex}`}
                          className="user-input-inline-answer"
                        >
                          <UserInputInlineTokens
                            value={answer}
                            workspacePath={workspacePath}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="user-input-inline-empty-answer">
                      {isAnswered ? "No answer provided." : "Awaiting user input."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export const ToolRow = memo(function ToolRow({
  item,
  isExpanded,
  onToggle,
  showMessageFilePath,
  workspacePath,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onRequestAutoScroll,
}: ToolRowProps) {
  const { t } = useI18nSafe();
  const isFileChange = item.toolType === "fileChange";
  const isCommand = item.toolType === "commandExecution";
  const isPlan = item.toolType === "plan";
  const commandText = isCommand
    ? item.title.replace(/^Command:\s*/i, "").trim()
    : "";
  const summary = useMemo(() => buildToolSummary(item, commandText), [commandText, item]);
  const structuredToolArgs = useMemo(() => parseStructuredToolArgs(item), [item]);
  const structuredToolCodeBlock = useMemo(
    () => structuredToolArgs ? buildFencedCodeBlock("js", structuredToolArgs.code) : "",
    [structuredToolArgs],
  );
  const changeNames = useMemo(
    () => (item.changes ?? []).map((change) => basename(change.path)).filter(Boolean),
    [item.changes],
  );
  const changeDiffStats = useMemo(
    () => {
      if (!isFileChange || !item.changes?.length) {
        return [];
      }
      return item.changes.map((change) => countInlineDiffStats(change.diff ?? ""));
    },
    [isFileChange, item.changes],
  );
  const totalDiffStats = useMemo(() => {
    if (!isFileChange) {
      return { additions: 0, deletions: 0 };
    }
    const hasChangeDiffs = (item.changes ?? []).some((change) =>
      Boolean(change.diff?.trim()),
    );
    if (hasChangeDiffs) {
      return mergeInlineDiffStats(changeDiffStats);
    }
    return countInlineDiffStats(item.output ?? "");
  }, [changeDiffStats, isFileChange, item.changes, item.output]);
  const hasChanges = changeNames.length > 0;
  const tone = toolStatusTone(item, hasChanges);
  const ToolIcon = toolIconForSummary(item, summary);
  const summaryLabel = isFileChange
    ? String(t("messages.codex.filesEdited", { count: changeNames.length || 1 }))
    : isCommand
      ? ""
      : summary.label;
  const inlineStatus = formatToolStatusLabel(item);
  const summaryValue = isFileChange
    ? changeNames.length > 1
      ? `${changeNames[0]} +${changeNames.length - 1}`
      : changeNames[0] || String(t("messages.codex.changes"))
    : structuredToolArgs?.title || summary.value;
  const summaryDetail = structuredToolArgs ? structuredToolArgs.detail : summary.detail;
  const ToolChevronIcon = isExpanded ? ChevronDown : ChevronRight;
  const showToolOutput = isExpanded && (!isFileChange || !hasChanges);
  const normalizedStatus = (item.status ?? "").toLowerCase();
  const isCommandRunning = isCommand && /in[_\s-]*progress|running|started/.test(normalizedStatus);
  const commandDurationMs =
    typeof item.durationMs === "number" ? item.durationMs : null;
  const isLongRunning = commandDurationMs !== null && commandDurationMs >= 1200;
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const [isExportingPlan, setIsExportingPlan] = useState(false);

  useEffect(() => {
    if (!isCommandRunning) {
      setShowLiveOutput(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShowLiveOutput(true);
    }, 600);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCommandRunning]);

  const showCommandOutput =
    isCommand &&
    summary.output &&
    (isExpanded || (isCommandRunning && showLiveOutput) || isLongRunning);

  useEffect(() => {
    if (showCommandOutput && isCommandRunning && showLiveOutput) {
      onRequestAutoScroll?.();
    }
  }, [isCommandRunning, onRequestAutoScroll, showCommandOutput, showLiveOutput]);

  const handlePlanExport = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const output = (summary.output ?? "").trim();
      if (!output) {
        return;
      }
      setIsExportingPlan(true);
      try {
        await exportMarkdownFile(output, buildPlanExportFileName(item.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to export plan.";
        pushErrorToast({
          title: "Plan export failed",
          message,
        });
      } finally {
        setIsExportingPlan(false);
      }
    },
    [item.id, summary.output],
  );
  const handleSummaryClick = useCallback(() => {
    onToggle(item.id);
  }, [item.id, onToggle]);

  return (
    <div className={`tool-inline tool-inline-row ${isExpanded ? "tool-inline-expanded" : ""}`}>
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={() => onToggle(item.id)}
        aria-expanded={isExpanded}
        aria-label="Toggle tool details"
      />
      <div className="tool-inline-content">
        <button
          type="button"
          className="tool-inline-summary tool-inline-toggle"
          onClick={handleSummaryClick}
          aria-expanded={isExpanded}
        >
          <span className="tool-inline-chevron" aria-hidden>
            <ToolChevronIcon size={16} />
          </span>
          {isCommand ? (
            <span className={`tool-inline-icon ${tone}`} aria-hidden>
              <TerminalIcon className="tool-inline-icon-svg" />
            </span>
          ) : (
            <ToolIcon className={`tool-inline-icon ${tone}`} size={16} aria-hidden />
          )}
          {summaryLabel && (
            <span className="tool-inline-label">{summaryLabel}:</span>
          )}
          {summaryValue && (
            <span
              className={`tool-inline-value ${isCommand ? "tool-inline-command" : ""}`}
            >
              {isCommand ? (
                <span className="tool-inline-command-text">{summaryValue}</span>
              ) : (
                summaryValue
              )}
            </span>
          )}
          {isFileChange && (
            <DiffStatsInline
              additions={totalDiffStats.additions}
              deletions={totalDiffStats.deletions}
            />
          )}
          {inlineStatus && (
            <span className="tool-inline-status">{inlineStatus}</span>
          )}
        </button>
        {isExpanded && summaryDetail && !isFileChange && (
          <div className="tool-inline-detail">{summaryDetail}</div>
        )}
        {isExpanded && structuredToolCodeBlock && (
          <Markdown
            value={structuredToolCodeBlock}
            className="tool-inline-code markdown"
            codeBlockStyle="message"
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
        {isExpanded && isFileChange && hasChanges && (
          <div className="tool-inline-change-list">
            {item.changes?.map((change, index) => (
              <div
                key={`${change.path}-${index}`}
                className="tool-inline-change"
              >
                {/* <div className="tool-inline-change-header">
                  {change.kind && (
                    <span className="tool-inline-change-kind">
                      {change.kind.toUpperCase()}
                    </span>
                  )}
                  <span className="tool-inline-change-path">
                    {basename(change.path)}
                  </span>
                  <DiffStatsInline
                    additions={changeDiffStats[index]?.additions ?? 0}
                    deletions={changeDiffStats[index]?.deletions ?? 0}
                  />
                </div> */}
                {change.diff && (
                  <div className="diff-viewer-output">
                    <PierreDiffBlock
                      diff={change.diff}
                      displayPath={change.path}
                      defaultExpanded
                      hidePatchMetadata
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {isExpanded && isFileChange && !hasChanges && item.detail && (
          <Markdown
            value={item.detail}
            className="item-text markdown"
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
        {showCommandOutput && (
          <CommandOutput
            command={summaryValue}
            cwd={item.detail}
            output={summary.output ?? ""}
          />
        )}
        {showToolOutput && summary.output && !isCommand && (
          <Markdown
            value={summary.output}
            className="tool-inline-output markdown"
            codeBlock={item.toolType !== "plan"}
            showFilePath={showMessageFilePath}
            workspacePath={workspacePath}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            onOpenThreadLink={onOpenThreadLink}
          />
        )}
        {showToolOutput && isPlan && (summary.output ?? "").trim() && (
          <div className="tool-inline-actions">
            <button
              type="button"
              className="ghost tool-inline-action"
              onClick={handlePlanExport}
              disabled={isExportingPlan}
            >
              {isExportingPlan ? "Exporting..." : "Export .md"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export const ExploreRow = memo(function ExploreRow({ item }: ExploreRowProps) {
  const title = item.status === "exploring" ? "Exploring" : "Explored";
  return (
    <div className="tool-inline explore-inline">
      <div className="tool-inline-bar-toggle" aria-hidden />
      <div className="tool-inline-content">
        <div className="explore-inline-header">
          <span
            className={`tool-inline-icon ${
              item.status === "exploring" ? "processing" : "completed"
            }`}
            aria-hidden
          >
            <TerminalIcon className="tool-inline-icon-svg" />
          </span>
          <span className="explore-inline-title">{title}</span>
        </div>
        <div className="explore-inline-list">
          {item.entries.map((entry, index) => (
            <div key={`${entry.kind}-${entry.label}-${index}`} className="explore-inline-item">
              <span className="explore-inline-kind">{exploreKindLabel(entry.kind)}</span>
              <span className="explore-inline-label">{entry.label}</span>
              {entry.detail && entry.detail !== entry.label && (
                <span className="explore-inline-detail">{entry.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
