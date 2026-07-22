import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { homeDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { renderAsync } from "docx-preview";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Minus from "lucide-react/dist/esm/icons/minus";
import Plus from "lucide-react/dist/esm/icons/plus";
import X from "lucide-react/dist/esm/icons/x";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Folder from "lucide-react/dist/esm/icons/folder";
import Globe from "lucide-react/dist/esm/icons/globe";
import MessageCirclePlus from "lucide-react/dist/esm/icons/message-circle-plus";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import { PanelShell } from "../../layout/components/PanelShell";
import { Markdown } from "../../messages/components/Markdown";
import {
  getCachedCodeBlockHtml,
  highlightCodeBlockHtml,
} from "../../messages/utils/shiki";
import { useResolvedAppTheme } from "../../messages/utils/useResolvedAppTheme";
import { TerminalPanel } from "../../terminal/components/TerminalPanel";
import { PanelMeta } from "../../design-system/components/panel/PanelPrimitives";
import { FileTreePanel } from "../../layout/components/FileTreePanel";
import { PierreDiffBlock } from "../../git/components/PierreDiffBlock";
import type { PerFileDiffViewerEntry } from "../../git/utils/perFileThreadDiffs";
import {
  listDirectoryFiles,
  readBinaryFile,
  readBinaryFilePath,
  readWorkspaceFile,
} from "../../../services/tauri";
import type { BinaryFileResponse } from "../../../services/tauri";
import type { TerminalSessionState } from "../../terminal/hooks/useTerminalSession";
import { isAbsolutePath, joinWorkspacePath } from "../../../utils/platformPaths";
import { languageFromPath } from "../../../utils/syntax";
import { getFileTypeIconUrl } from "../../../utils/fileTypeIcons";

export type FilePreviewPanelProps = {
  workspaceId: string | null;
  workspacePath: string | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  previewPath: string | null;
  previewTabs?: string[];
  isPanelVisible?: boolean;
  onPreviewPathChange?: (path: string | null) => void;
  onPreviewTabClose?: (path: string) => void;
  onPreviewSideChat?: () => void;
  onPreviewTerminal?: () => void;
  terminalState?: TerminalSessionState | null;
  fileTreeProps?: ComponentProps<typeof FileTreePanel> | null;
  diffPreviewEntries?: PerFileDiffViewerEntry[];
};

type SpreadsheetSheet = {
  name: string;
  rows: string[][];
  columnCount: number;
};

type PptxPreviewerInstance = {
  preview: (source: ArrayBuffer) => Promise<unknown>;
  destroy: () => void;
};

const DEFAULT_DOCX_ZOOM = 75;
export const FILE_TREE_PREVIEW_PATH = "tree:";
export const DIFF_PREVIEW_PREFIX = "diff:";
export const CANVAS_PREVIEW_PATH = "canvas:";
const CANVAS_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>`,
)}`;
const HIGHLIGHT_MAX_CONTENT_LENGTH = 500_000;
const MATERIAL_FOLDER_ICON_URL = "/assets/material-icons/folder.svg";
const MATERIAL_GOOGLE_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<?xml version="1.0" encoding="utf-8"?><!-- Uploaded to: SVG Repo, www.svgrepo.com, Generator: SVG Repo Mixer Tools -->
<svg width="800px" height="800px" viewBox="-0.82 0 437.46 437.46" xmlns="http://www.w3.org/2000/svg"><path d="M217.341.039s128.478-5.783 196.57 123.337H206.416s-39.188-1.289-72.593 46.255c-9.634 19.916-19.91 40.473-8.349 80.937C108.773 222.309 36.823 97.04 36.823 97.04S87.578 5.176 217.341.039z" fill="#c6352e"/><path d="M407.223 327.871s-59.247 114.143-205.118 108.533c17.995-31.148 103.772-179.682 103.772-179.682s20.709-33.289-3.744-85.991c-12.431-18.305-25.09-37.486-65.919-47.713 32.836-.326 177.285.021 177.285.021s54.168 89.891-6.276 204.832z" fill="#f4d911"/><path d="M28.373 328.738s-69.224-108.395 8.58-231.908c17.979 31.16 103.71 179.72 103.71 179.72s18.469 34.578 76.341 39.756c22.061-1.609 45.007-2.982 74.279-33.223-16.139 28.594-88.673 153.521-88.673 153.521S97.681 438.56 28.373 328.738z" fill="#81b354"/><path d="M202.105 437.46l29.187-121.793s32.092-2.504 58.982-32.017c-16.693 29.365-88.169 153.81-88.169 153.81z" fill="#7baa50"/><path d="M119.59 220.093c0-53.69 43.52-97.215 97.215-97.215 53.69 0 97.214 43.524 97.214 97.215 0 53.693-43.522 97.219-97.214 97.219-53.695 0-97.215-43.525-97.215-97.219z" fill="#ffffff"/><linearGradient id="a" gradientUnits="userSpaceOnUse" x1="-829.128" y1="1417.339" x2="-829.128" y2="1261.441" gradientTransform="matrix(1 0 0 -1 1045.93 1557.636)"><stop offset="0" stop-color="#a2c0e6"/><stop offset="1" stop-color="#406cb1"/></linearGradient><path d="M135.86 220.093c0-44.702 36.238-80.941 80.945-80.941 44.698 0 80.94 36.239 80.94 80.941 0 44.703-36.242 80.945-80.94 80.945-44.707.001-80.945-36.244-80.945-80.945z" fill="url(#a)"/><path d="M413.5 123.039l-120.183 35.237s-18.123-26.596-57.104-35.258c33.776-.115 177.287.021 177.287.021z" fill="#e7ce12"/><path d="M123.137 246.197c-16.89-29.25-86.31-149.16-86.31-149.16l89.029 88.07s-9.149 18.82-5.68 45.7l2.961 15.39z" fill="#bc332c"/></svg>`,
)}`;

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "avif",
  "bmp",
  "heic",
  "heif",
  "tif",
  "tiff",
]);

const VIDEO_EXTENSIONS = new Set([
  "m4v",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "ogv",
  "webm",
]);

const BINARY_EXTENSIONS = new Set([
  "7z",
  "a",
  "ar",
  "bin",
  "class",
  "dll",
  "dmg",
  "dylib",
  "eot",
  "exe",
  "gz",
  "ico",
  "jar",
  "lockb",
  "mov",
  "mp3",
  "mp4",
  "o",
  "otf",
  "pdf",
  "pkl",
  "png",
  "pyc",
  "so",
  "tar",
  "ttf",
  "wasm",
  "webm",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
]);

function extensionOf(path: string) {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  return lastDot >= 0 ? normalized.slice(lastDot + 1) : "";
}

function previewKindOf(path: string | null): "image" | "video" | "pdf" | "docx" | "xlsx" | "pptx" | "text" | "other" {
  if (!path) {
    return "other";
  }
  if (path.startsWith("data:image/")) {
    return "image";
  }
  const ext = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(ext)) {
    return "image";
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return "video";
  }
  if (ext === "pdf") {
    return "pdf";
  }
  if (ext === "docx") {
    return "docx";
  }
  if (["xlsx", "xls"].includes(ext)) {
    return "xlsx";
  }
  if (["pptx", "ppt"].includes(ext)) {
    return "pptx";
  }
  if (!ext) {
    return "text";
  }
  return BINARY_EXTENSIONS.has(ext) ? "other" : "text";
}

export function fileTitle(path: string | null) {
  if (!path) {
    return "No file selected";
  }
  if (path.startsWith(DIFF_PREVIEW_PREFIX)) {
    const diffPath = path.slice(DIFF_PREVIEW_PREFIX.length);
    const displayPath = diffPath.split("@@item-")[0] ?? diffPath;
    const normalized = displayPath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "Diff";
  }
  if (path.startsWith("tree:")) {
    return path.slice("tree:".length).replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "Folder";
  }
  if (path.startsWith("browser:")) {
    const url = path.slice("browser:".length);
    return url || "Browser";
  }
  if (path === CANVAS_PREVIEW_PATH) {
    return "画布";
  }
  if (path === "terminal:") {
    return "Terminal";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function isMarkdownPath(path: string | null) {
  return extensionOf(path ?? "") === "md";
}

function normalizePreviewTreePath(path: string | null, workspacePath: string | null) {
  const trimmedPath = path?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  if (!trimmedPath) {
    return "";
  }
  const trimmedWorkspace = workspacePath?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? "";
  if (trimmedWorkspace) {
    if (trimmedPath === trimmedWorkspace) {
      return "";
    }
    if (trimmedPath.startsWith(`${trimmedWorkspace}/`)) {
      return trimmedPath.slice(trimmedWorkspace.length + 1);
    }
  }
  if (isAbsolutePath(trimmedPath)) {
    return "";
  }
  return trimmedPath.replace(/^\/+/, "");
}

function isDirectoryPreviewPath(
  path: string | null,
  workspacePath: string | null,
  files: string[],
) {
  // Paths starting with ~ are absolute home directory paths, not relative workspace paths
  // They should not be treated as directory preview paths
  if (path?.startsWith("~")) {
    return false;
  }
  const relativePath = normalizePreviewTreePath(path, workspacePath);
  if (!relativePath) {
    return false;
  }
  // Check if this path has children (is a directory) by looking for files under it
  const prefix = `${relativePath}/`;
  const hasChildren = files.some((file) => {
    const normalizedFile = file.replace(/\\/g, "/");
    return normalizedFile.startsWith(prefix);
  });
  // Only treat as directory preview if it has children, not if it's a direct file match
  return hasChildren;
}

function isBrowserPreview(path: string | null) {
  return Boolean(path?.startsWith("browser:"));
}

function isCanvasPreview(path: string | null) {
  return path === CANVAS_PREVIEW_PATH;
}

function isDiffPreview(path: string | null) {
  return Boolean(path?.startsWith(DIFF_PREVIEW_PREFIX));
}

function diffPreviewEntryId(path: string | null) {
  return path?.startsWith(DIFF_PREVIEW_PREFIX)
    ? path.slice(DIFF_PREVIEW_PREFIX.length)
    : null;
}

export function previewTabIconUrl(path: string) {
  if (isDiffPreview(path)) {
    const diffPath = path.slice(DIFF_PREVIEW_PREFIX.length).split("@@item-")[0] ?? path;
    return getFileTypeIconUrl(diffPath);
  }
  if (isTreePreview(path)) {
    return MATERIAL_FOLDER_ICON_URL;
  }
  if (isBrowserPreview(path)) {
    return MATERIAL_GOOGLE_ICON_URL;
  }
  if (isCanvasPreview(path)) {
    return CANVAS_ICON_URL;
  }
  return getFileTypeIconUrl(path);
}

function isTreePreview(path: string | null) {
  return Boolean(path?.startsWith("tree:"));
}

function browserUrlFromPath(path: string | null) {
  return path?.startsWith("browser:") ? path.slice("browser:".length) : "";
}

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (!trimmed) {
    return "";
  }
  const withProtocol = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname === "/" && !url.search && !url.hash) {
      return url.origin;
    }
    return url.toString();
  } catch {
    return "";
  }
}

function resolvePreviewSrc(
  path: string | null,
  workspacePath: string | null,
  kind: "image" | "video" | "pdf" | "docx" | "xlsx" | "pptx" | "text" | "other",
  pdfZoom: number,
) {
  if (!path) {
    return "";
  }
  if (path.startsWith("data:")) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    const absolutePath = workspacePath ? joinWorkspacePath(workspacePath, path) : path;
    const src = convertFileSrc(absolutePath);
    if (kind === "pdf") {
      return `${src}#toolbar=0&navpanes=0&scrollbar=0&zoom=${pdfZoom}`;
    }
    return src;
  } catch {
    return "";
  }
}

function pdfFrameSrc(src: string, zoom: number) {
  if (!src) {
    return "";
  }
  return `${src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH&zoom=${zoom}`;
}

function normalizeComparablePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function isPathWithinWorkspace(path: string, workspacePath: string | null) {
  if (!workspacePath || !isAbsolutePath(path)) {
    return false;
  }
  const normalizedPath = normalizeComparablePath(path);
  const normalizedWorkspacePath = normalizeComparablePath(workspacePath);
  return normalizedPath === normalizedWorkspacePath || normalizedPath.startsWith(`${normalizedWorkspacePath}/`);
}

// Convert absolute path to relative path for workspace file reading
function toWorkspaceRelativePath(path: string, workspacePath: string | null): string {
  if (!workspacePath || !isAbsolutePath(path)) {
    return path;
  }
  const normalizedPath = normalizeComparablePath(path);
  const normalizedWorkspacePath = normalizeComparablePath(workspacePath);
  if (normalizedPath.startsWith(`${normalizedWorkspacePath}/`)) {
    return normalizedPath.slice(normalizedWorkspacePath.length + 1);
  }
  return path;
}

// Expand ~ to the home directory (synchronous version for use in comparisons)
function expandHomePathSync(path: string, homePath: string | null): string {
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

function shouldReadViaWorkspace(
  workspaceId: string | null,
  workspacePath: string | null,
  path: string | null,
) {
  if (!workspaceId || !path || path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return false;
  }
  return !isAbsolutePath(path) || isPathWithinWorkspace(path, workspacePath);
}

function binaryResponseToArrayBuffer(response: BinaryFileResponse) {
  const binaryString = atob(response.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function binaryResponseToText(response: BinaryFileResponse) {
  const binaryString = atob(response.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function binaryResponseToObjectUrl(response: BinaryFileResponse, fallbackMimeType: string) {
  const binaryString = atob(response.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return URL.createObjectURL(
    new Blob([bytes.buffer], { type: response.mime_type || fallbackMimeType }),
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function loadPreviewArrayBuffer(
  workspaceId: string | null,
  readViaWorkspace: boolean,
  path: string,
  previewSrc: string,
  errorLabel: string,
) {
  if (readViaWorkspace && workspaceId) {
    return binaryResponseToArrayBuffer(await readBinaryFile(workspaceId, path));
  }
  if (isAbsolutePath(path)) {
    return binaryResponseToArrayBuffer(await readBinaryFilePath(path));
  }
  if (previewSrc) {
    const response = await fetch(previewSrc);
    if (!response.ok) {
      throw new Error(`Failed to load ${errorLabel} preview (${response.status})`);
    }
    return response.arrayBuffer();
  }
  throw new Error(`No valid source for ${errorLabel} preview`);
}

function spreadsheetColumnLabel(index: number) {
  let current = index;
  let label = "";
  while (current >= 0) {
    label = String.fromCharCode((current % 26) + 65) + label;
    current = Math.floor(current / 26) - 1;
  }
  return label;
}

function PlainTextCodeWithLineNumbers({ value }: { value: string }) {
  const lines = value.split("\n");
  return (
    <div className="file-preview-code-plain-lines" role="presentation">
      {lines.map((line, index) => (
        <div key={`${index}-${line.length}`} className="file-preview-code-plain-line">
          <span className="file-preview-code-plain-line-number" aria-hidden>
            {index + 1}
          </span>
          <span className="file-preview-code-plain-line-text">{line || "\u00A0"}</span>
        </div>
      ))}
    </div>
  );
}

function PreviewAddPanel({ onPickFile, onOpenBrowser, onSideChat, onTerminal, onOpenCanvas }: { onPickFile: () => void; onOpenBrowser: () => void; onSideChat?: () => void; onTerminal?: () => void; onOpenCanvas: () => void }) {
  const { t } = useTranslation();
  const actions = [
    { icon: <LayoutGrid size={26} aria-hidden />, title: t("filePreview.infiniteCanvas"), subtitle: t("filePreview.visualCanvas"), shortcut: "⌃⇧G", onClick: onOpenCanvas },
    { icon: <TerminalSquare size={26} aria-hidden />, title: t("filePreview.terminal"), subtitle: t("filePreview.startInteractiveShell"), onClick: onTerminal },
    { icon: <Globe size={26} aria-hidden />, title: t("filePreview.webPage"), subtitle: t("filePreview.previewOrExternal"), shortcut: "⌘T", onClick: onOpenBrowser },
    { icon: <Folder size={26} aria-hidden />, title: t("filePreview.file"), subtitle: t("filePreview.browseProjectFiles"), shortcut: "⌘P", onClick: onPickFile },
    { icon: <MessageCirclePlus size={26} aria-hidden />, title: t("filePreview.sideChat"), subtitle: t("filePreview.startSideConversation"), shortcut: "⌥⌘S", onClick: onSideChat },
  ];

  return (
    <div className="file-preview-add-panel" aria-label="Add preview tab">
      <div className="file-preview-add-list" role="list">
        {actions.map((action) => (
          <button key={action.title} type="button" className="file-preview-add-card" aria-label={action.title} onClick={action.onClick} disabled={!action.onClick}>
            <span className="file-preview-add-card-main">
              <span className="file-preview-add-card-icon">{action.icon}</span>
              <span className="file-preview-add-card-copy">
                <span className="file-preview-add-card-title">{action.title}</span>
                <span className="file-preview-add-card-subtitle">{action.subtitle}</span>
              </span>
            </span>
            {action.shortcut ? <span className="file-preview-add-card-shortcut" aria-hidden>{action.shortcut}</span> : <span className="file-preview-add-card-shortcut file-preview-add-card-shortcut--empty" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilePreviewTabBar({
  paths,
  activePath,
  onPreviewPathChange,
  onPreviewTabClose,
}: {
  paths: string[];
  activePath: string | null;
  onPreviewPathChange?: (path: string | null) => void;
  onPreviewTabClose?: (path: string) => void;
}) {
  const tabbarRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const hasOpenPreviews = paths.length > 0;
  const showTabs = Boolean(activePath) || hasOpenPreviews;

  const updateScrollButtons = () => {
    const tabbar = tabbarRef.current;
    if (!tabbar) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }
    const maxScrollLeft = tabbar.scrollWidth - tabbar.clientWidth;
    setCanScrollLeft(tabbar.scrollLeft > 1);
    setCanScrollRight(tabbar.scrollLeft < maxScrollLeft - 1);
  };

  const scrollTabs = (direction: "left" | "right") => {
    const tabbar = tabbarRef.current;
    if (!tabbar) {
      return;
    }
    const distance = Math.max(160, Math.floor(tabbar.clientWidth * 0.75));
    tabbar.scrollBy({
      left: direction === "left" ? -distance : distance,
      behavior: "smooth",
    });
  };

  useEffect(() => {
    const tabbar = tabbarRef.current;
    if (!tabbar) {
      return;
    }
    updateScrollButtons();
    const frameId = requestAnimationFrame(updateScrollButtons);
    tabbar.addEventListener("scroll", updateScrollButtons, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollButtons);
    resizeObserver.observe(tabbar);
    return () => {
      cancelAnimationFrame(frameId);
      tabbar.removeEventListener("scroll", updateScrollButtons);
      resizeObserver.disconnect();
    };
  }, [paths, activePath]);

  useEffect(() => {
    const activeTab = tabbarRef.current?.querySelector<HTMLElement>(".file-preview-tab.is-active");
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activePath]);

  if (!showTabs) {
    return null;
  }

  return (
    <div className="file-preview-tabbar-wrap">
      <button
        type="button"
        className="file-preview-tab-add"
        data-tauri-drag-region="false"
        onClick={() => onPreviewPathChange?.(null)}
        aria-label="Add preview tab"
        title="Add preview tab"
      >
        <Plus size={15} aria-hidden />
      </button>
      <button
        type="button"
        className="file-preview-tab-scroll"
        data-tauri-drag-region="false"
        onClick={() => scrollTabs("left")}
        disabled={!canScrollLeft}
        aria-label="Scroll preview tabs left"
        title="Scroll preview tabs left"
      >
        <ChevronLeft size={15} aria-hidden />
      </button>
      <div
        ref={tabbarRef}
        className="file-preview-tabbar"
        role="tablist"
        aria-label="Open previews"
        data-tauri-drag-region="false"
      >
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            className={`file-preview-tab${path === activePath ? " is-active" : ""}`}
            data-tauri-drag-region="false"
            onClick={() => onPreviewPathChange?.(path)}
            role="tab"
            aria-selected={path === activePath}
            title={path}
          >
            <span className="file-preview-tab-leading">
              <img
                className="file-preview-tab-file-icon"
                src={previewTabIconUrl(path)}
                alt=""
                aria-hidden
              />
              <span
                role="button"
                className="file-preview-tab-close"
                aria-label={`Close ${fileTitle(path)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onPreviewTabClose?.(path);
                }}
              >
                <X size={12} aria-hidden />
              </span>
            </span>
            <span>{fileTitle(path)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="file-preview-tab-scroll"
        data-tauri-drag-region="false"
        onClick={() => scrollTabs("right")}
        disabled={!canScrollRight}
        aria-label="Scroll preview tabs right"
        title="Scroll preview tabs right"
      >
        <ChevronRight size={15} aria-hidden />
      </button>
    </div>
  );
}

type BrowserPreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function browserPreviewBounds(host: HTMLElement): BrowserPreviewBounds {
  const rect = host.getBoundingClientRect();
  return {
    x: Math.max(0, rect.left),
    y: Math.max(0, rect.top),
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
  };
}

function browserPreviewHostVisible(host: HTMLElement) {
  if (!host.isConnected) {
    return false;
  }
  const rect = host.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) {
    return false;
  }
  if (host.closest(".app.right-panel-collapsed .right-panel")) {
    return false;
  }
  let current: HTMLElement | null = host;
  while (current) {
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

function browserPreviewErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function TauriBrowserPreview({
  url,
  isVisible,
  onOpenExternal,
}: {
  url: string;
  isVisible: boolean;
  onOpenExternal: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef("file-preview-browser-webview");
  const webviewRef = useRef<Webview | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const label = labelRef.current;
    return () => {
      readyRef.current = false;
      void webviewRef.current?.close().catch(() => {});
      webviewRef.current = null;
      void invoke("browser_preview_hide", { label }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const viewport = viewportRef.current;
    const label = labelRef.current;

    const hidePreview = () => {
      readyRef.current = false;
      const webview = webviewRef.current;
      webviewRef.current = null;
      void webview?.close().catch(() => {});
      void invoke("browser_preview_hide", { label }).catch(() => {});
    };

    if (!isVisible || !viewport || !browserPreviewHostVisible(viewport)) {
      hidePreview();
      return () => {
        cancelled = true;
      };
    }

    const syncBounds = () => {
      if (cancelled) {
        return;
      }
      if (!browserPreviewHostVisible(viewport)) {
        hidePreview();
        return;
      }
      if (readyRef.current) {
        const bounds = browserPreviewBounds(viewport);
        const webview = webviewRef.current;
        void webview
          ?.setPosition(new LogicalPosition(bounds.x, bounds.y))
          .then(() => webview.setSize(new LogicalSize(bounds.width, bounds.height)))
          .then(() => webview.show())
          .catch((boundsError) => {
            if (!cancelled) {
              setStatus("error");
              setError(browserPreviewErrorMessage(boundsError));
            }
          });
      }
    };

    const scheduleSyncBounds = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(syncBounds);
    };

    setStatus("loading");
    setError(null);
    readyRef.current = false;

    void Webview.getByLabel(label)
      .then((existingWebview) => existingWebview?.close().catch(() => undefined))
      .then(() => {
        if (cancelled) {
          return null;
        }
        const bounds = browserPreviewBounds(viewport);
        const webview = new Webview(getCurrentWindow(), label, {
          url,
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          acceptFirstMouse: true,
          dragDropEnabled: false,
          focus: false,
        });
        webviewRef.current = webview;
        return new Promise<Webview>((resolve, reject) => {
          void webview.once("tauri://created", () => resolve(webview));
          void webview.once("tauri://error", (event) => reject(event.payload));
        });
      })
      .then((webview) => {
        if (!webview) {
          return;
        }
        if (cancelled) {
          hidePreview();
          return;
        }
        readyRef.current = true;
        setStatus("ready");
        scheduleSyncBounds();
      })
      .catch((previewError) => {
        if (!cancelled) {
          readyRef.current = false;
          setStatus("error");
          setError(browserPreviewErrorMessage(previewError));
        }
      });

    resizeObserver = new ResizeObserver(scheduleSyncBounds);
    resizeObserver.observe(viewport);

    const appElement = viewport.closest(".app");
    const rightPanel = viewport.closest(".right-panel");
    mutationObserver = new MutationObserver(scheduleSyncBounds);
    mutationObserver.observe(document.documentElement, {
      attributeFilter: ["class", "style", "hidden"],
      attributes: true,
    });
    mutationObserver.observe(document.body, {
      attributeFilter: ["class", "style", "hidden"],
      attributes: true,
    });
    if (appElement) {
      mutationObserver.observe(appElement, {
        attributeFilter: ["class", "style", "hidden"],
        attributes: true,
      });
    }
    if (rightPanel) {
      mutationObserver.observe(rightPanel, {
        attributeFilter: ["class", "style", "hidden"],
        attributes: true,
      });
    }
    window.addEventListener("resize", scheduleSyncBounds);
    window.addEventListener("scroll", scheduleSyncBounds, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleSyncBounds);
      window.removeEventListener("scroll", scheduleSyncBounds, true);
      hidePreview();
    };
  }, [isVisible, url]);

  return (
    <div className="file-preview-browser-native" ref={viewportRef}>
      <div className="file-preview-browser-webview-host" aria-hidden />
      {status !== "ready" ? (
        <div className="file-preview-browser-native-overlay">
          <img
            className="file-preview-browser-external-icon"
            src={MATERIAL_GOOGLE_ICON_URL}
            alt=""
            aria-hidden
          />
          <div className="file-preview-browser-external-title">
            {status === "loading" ? "Loading website..." : "WebView preview failed."}
          </div>
          {error ? <div className="file-preview-browser-external-url">{error}</div> : null}
          <button type="button" onClick={onOpenExternal}>
            <ExternalLink size={14} aria-hidden />
            Open website
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function FilePreviewPanel({
  workspaceId,
  workspacePath,
  filePanelMode,
  onFilePanelModeChange,
  previewPath,
  previewTabs = [],
  isPanelVisible = true,
  onPreviewPathChange,
  onPreviewTabClose,
  onPreviewSideChat,
  onPreviewTerminal,
  terminalState,
  fileTreeProps = null,
  diffPreviewEntries = [],
}: FilePreviewPanelProps) {
  const docxContainerRef = useRef<HTMLDivElement | null>(null);
  const pptxContainerRef = useRef<HTMLDivElement | null>(null);
  const pptxPreviewerRef = useRef<PptxPreviewerInstance | null>(null);
  const [pdfZoom, setPdfZoom] = useState(100);
  const [docxZoom, setDocxZoom] = useState(DEFAULT_DOCX_ZOOM);
  const [xlsxZoom, setXlsxZoom] = useState(100);
  const [pptxZoom, setPptxZoom] = useState(100);
  const [xlsxSheets, setXlsxSheets] = useState<SpreadsheetSheet[]>([]);
  const [xlsxSheetName, setXlsxSheetName] = useState("");
  const [content, setContent] = useState("");
  const [browserUrlInput, setBrowserUrlInput] = useState("");
  const [imageObjectUrl, setImageObjectUrl] = useState("");
  const [videoObjectUrl, setVideoObjectUrl] = useState("");
  const [pdfDataUrl, setPdfDataUrl] = useState("");
  const [directoryFiles, setDirectoryFiles] = useState<string[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeDirectory, setHomeDirectory] = useState<string | null>(null);
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null);
  const [highlightedContentHtml, setHighlightedContentHtml] = useState("");
  const effectiveWorkspacePath = useMemo(() => {
    if (!workspacePath) {
      return null;
    }
    const expanded = expandHomePathSync(workspacePath, homeDirectory);
    return expanded || workspacePath;
  }, [workspacePath, homeDirectory]);
  const visiblePreviewTabs = useMemo(
    () =>
      previewPath && previewPath !== FILE_TREE_PREVIEW_PATH && !previewTabs.includes(previewPath)
        ? [...previewTabs, previewPath]
        : previewTabs,
    [previewPath, previewTabs],
  );

  const isBrowser = isBrowserPreview(previewPath);
  const isDiff = isDiffPreview(previewPath);
  const isTerminal = previewPath === "terminal:";
  const isTree = isTreePreview(previewPath);
  const isCanvas = isCanvasPreview(previewPath);
  const browserUrl = browserUrlFromPath(previewPath);
  const activeDiffEntry = useMemo(() => {
    const id = diffPreviewEntryId(previewPath);
    return id ? diffPreviewEntries.find((entry) => entry.path === id) ?? null : null;
  }, [diffPreviewEntries, previewPath]);
  const previewKind = useMemo(
    () => (isBrowser || isCanvas || isDiff || isTerminal || isTree ? "other" : previewKindOf(previewPath)),
    [isBrowser, isCanvas, isDiff, isTerminal, isTree, previewPath],
  );
  const isMarkdownPreview = useMemo(() => isMarkdownPath(previewPath), [previewPath]);
  const previewSrc = useMemo(
    () => resolvePreviewSrc(previewPath, effectiveWorkspacePath, previewKind, pdfZoom),
    [effectiveWorkspacePath, pdfZoom, previewKind, previewPath],
  );
  const pdfPreviewFrameSrc = useMemo(
    () => pdfFrameSrc(pdfDataUrl, pdfZoom),
    [pdfDataUrl, pdfZoom],
  );
  const readViaWorkspace = useMemo(
    () => shouldReadViaWorkspace(workspaceId, effectiveWorkspacePath, expandedPreviewPath ?? previewPath),
    [effectiveWorkspacePath, expandedPreviewPath, previewPath, workspaceId],
  );
  const isDirectoryPreview = useMemo(
    () =>
      !isDiff &&
      (isTree ||
        isDirectoryPreviewPath(
          previewPath,
          effectiveWorkspacePath,
          fileTreeProps?.files ?? [],
        )),
    [effectiveWorkspacePath, fileTreeProps?.files, isDiff, isTree, previewPath],
  );

  const directoryPreviewPath = useMemo(() => {
    if (!isDirectoryPreview || !previewPath) {
      return "";
    }
    if (previewPath === FILE_TREE_PREVIEW_PATH) {
      return effectiveWorkspacePath ?? fileTreeProps?.workspacePath ?? "";
    }
    if (previewPath.startsWith("tree:")) {
      return previewPath.slice("tree:".length);
    }
    return previewPath;
  }, [effectiveWorkspacePath, fileTreeProps?.workspacePath, isDirectoryPreview, previewPath]);

  // Reset state when file changes
  useEffect(() => {
    setPdfZoom(100);
    setDocxZoom(DEFAULT_DOCX_ZOOM);
    setXlsxZoom(100);
    setPptxZoom(100);
    setXlsxSheets([]);
    setXlsxSheetName("");
    setImageObjectUrl("");
    setVideoObjectUrl("");
    setPdfDataUrl("");
    setError(null);
  }, [previewPath]);

  // Get home directory on mount
  useEffect(() => {
    let cancelled = false;
    homeDir()
      .then((path) => {
        if (!cancelled) {
          setHomeDirectory(path);
        }
      })
      .catch(() => {
        // Home directory not available, that's okay
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Update expanded preview path when previewPath or homeDirectory changes
  useEffect(() => {
    if (
      !previewPath ||
      isDiff ||
      previewPath.startsWith("data:") ||
      previewPath.startsWith("http://") ||
      previewPath.startsWith("https://")
    ) {
      setExpandedPreviewPath(null);
      return;
    }
    const expanded = expandHomePathSync(previewPath, homeDirectory);
    setExpandedPreviewPath(expanded !== previewPath ? expanded : null);
  }, [isDiff, previewPath, homeDirectory]);

  useEffect(() => {
    let cancelled = false;
    if (
      !isDirectoryPreview ||
      !directoryPreviewPath ||
      previewPath === FILE_TREE_PREVIEW_PATH
    ) {
      setDirectoryFiles([]);
      setDirectoryError(null);
      setDirectoryLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setDirectoryError(null);
    setDirectoryLoading(true);
    listDirectoryFiles(directoryPreviewPath)
      .then((files) => {
        if (!cancelled) {
          setDirectoryFiles(files);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDirectoryError(loadError instanceof Error ? loadError.message : String(loadError));
          setDirectoryFiles([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDirectoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [directoryPreviewPath, isDirectoryPreview, previewPath]);

  useEffect(() => {
    setBrowserUrlInput(browserUrl);
  }, [browserUrl]);

  const handlePickPreviewFile = async () => {
    const selection = await open({ multiple: false });
    if (!selection || Array.isArray(selection)) {
      return;
    }
    onPreviewPathChange?.(selection);
  };

  const handleOpenBrowserPreview = () => {
    onPreviewPathChange?.("browser:");
  };

  const handleBrowserUrlSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextUrl = normalizeBrowserUrl(browserUrlInput);
    if (nextUrl) {
      setBrowserUrlInput(nextUrl);
      onPreviewPathChange?.(`browser:${nextUrl}`);
    }
  };

  const handleBrowserUrlBlur = () => {
    const nextUrl = normalizeBrowserUrl(browserUrlInput);
    if (nextUrl) {
      setBrowserUrlInput(nextUrl);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const container = docxContainerRef.current;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    if (!previewPath || previewKind !== "docx") {
      return;
    }
    setError(null);
    setIsLoading(true);

    const loadDocx = async () => {
      try {
        const pathForReading = expandedPreviewPath ?? previewPath;
        const buffer = await loadPreviewArrayBuffer(
          workspaceId,
          readViaWorkspace,
          toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath),
          previewSrc,
          "DOCX",
        );

        if (cancelled || !docxContainerRef.current) {
          return;
        }
        await renderAsync(buffer, docxContainerRef.current, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: false,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        });
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadDocx();

    return () => {
      cancelled = true;
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [previewKind, previewPath, readViaWorkspace, workspaceId, previewSrc, homeDirectory, expandedPreviewPath, effectiveWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    if (!previewPath || previewKind !== "image" || previewPath.startsWith("data:") || previewPath.startsWith("http://") || previewPath.startsWith("https://")) {
      setImageObjectUrl("");
      return () => {
        cancelled = true;
      };
    }
    // For paths starting with ~, wait for home directory to be available
    if (previewPath.startsWith("~") && !homeDirectory) {
      // Home directory not loaded yet, skip this run
      return () => {
        cancelled = true;
      };
    }
    setError(null);
    setIsLoading(true);

    const loadImage = async () => {
      try {
        let response: BinaryFileResponse;
        const pathForReading = expandedPreviewPath ?? previewPath;
        if (readViaWorkspace && workspaceId) {
          response = await readBinaryFile(workspaceId, toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath));
        } else if (isAbsolutePath(previewPath)) {
          response = await readBinaryFilePath(pathForReading);
        } else {
          throw new Error("Workspace image preview is unavailable.");
        }
        if (cancelled) {
          return;
        }
        objectUrl = binaryResponseToObjectUrl(response, "image/*");
        setImageObjectUrl(objectUrl);
      } catch (readError) {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewKind, previewPath, readViaWorkspace, workspaceId, homeDirectory, expandedPreviewPath, effectiveWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    if (!previewPath || previewKind !== "video" || previewPath.startsWith("http://") || previewPath.startsWith("https://")) {
      setVideoObjectUrl("");
      return () => {
        cancelled = true;
      };
    }
    if (previewPath.startsWith("~") && !homeDirectory) {
      return () => {
        cancelled = true;
      };
    }
    setError(null);
    setIsLoading(true);

    const loadVideo = async () => {
      try {
        let response: BinaryFileResponse;
        const pathForReading = expandedPreviewPath ?? previewPath;
        if (readViaWorkspace && workspaceId) {
          response = await readBinaryFile(workspaceId, toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath));
        } else if (isAbsolutePath(pathForReading)) {
          response = await readBinaryFilePath(pathForReading);
        } else {
          throw new Error("Workspace video preview is unavailable.");
        }
        if (cancelled) {
          return;
        }
        objectUrl = binaryResponseToObjectUrl(response, "video/mp4");
        setVideoObjectUrl(objectUrl);
      } catch (readError) {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadVideo();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewKind, previewPath, readViaWorkspace, workspaceId, homeDirectory, expandedPreviewPath, effectiveWorkspacePath]);

  // Load PDF as base64 data URL
  useEffect(() => {
    let cancelled = false;
    if (!previewPath || previewKind !== "pdf") {
      setPdfDataUrl("");
      return () => {
        cancelled = true;
      };
    }
    setError(null);
    setIsLoading(true);
    let objectUrl = "";

    const loadPdf = async () => {
      try {
        let response: BinaryFileResponse;
        const pathForReading = expandedPreviewPath ?? previewPath;
        if (readViaWorkspace && workspaceId) {
          response = await readBinaryFile(workspaceId, toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath));
        } else if (isAbsolutePath(previewPath)) {
          response = await readBinaryFilePath(pathForReading);
        } else if (previewSrc) {
          const fetched = await fetch(previewSrc);
          if (!fetched.ok) {
            throw new Error(`Failed to load PDF preview (${fetched.status})`);
          }
          const buffer = await fetched.arrayBuffer();
          response = {
            base64: arrayBufferToBase64(buffer),
            mime_type: fetched.headers.get("content-type") || "application/pdf",
          };
        } else {
          throw new Error("No valid source for PDF preview");
        }
        if (cancelled) {
          return;
        }
        objectUrl = binaryResponseToObjectUrl(response, "application/pdf");
        setPdfDataUrl(objectUrl);
      } catch (readError) {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewKind, previewPath, readViaWorkspace, workspaceId, previewSrc, homeDirectory, expandedPreviewPath, effectiveWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    if (!previewPath || previewKind !== "xlsx") {
      setXlsxSheets([]);
      setXlsxSheetName("");
      return () => {
        cancelled = true;
      };
    }
    setError(null);
    setIsLoading(true);

    const loadXlsx = async () => {
      try {
        const pathForReading = expandedPreviewPath ?? previewPath;
        const buffer = await loadPreviewArrayBuffer(
          workspaceId,
          readViaWorkspace,
          toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath),
          previewSrc,
          "Excel",
        );

        if (cancelled || !buffer) {
          return;
        }
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(buffer, {
          type: "array",
          cellDates: true,
          cellNF: true,
          cellStyles: true,
        });
        const parsedSheets = workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const ref = sheet?.["!ref"];
          if (!sheet || !ref) {
            return {
              name: sheetName,
              rows: [],
              columnCount: 0,
            };
          }
          const range = XLSX.utils.decode_range(ref);
          const rows: string[][] = [];
          let columnCount = 0;
          for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
            const row: string[] = [];
            for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
              const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
              row.push(cell ? XLSX.utils.format_cell(cell) : "");
            }
            columnCount = Math.max(columnCount, row.length);
            rows.push(row);
          }
          return {
            name: sheetName,
            rows,
            columnCount,
          };
        });
        setXlsxSheets(parsedSheets);
        setXlsxSheetName((current) => current || workbook.SheetNames[0] || "");
      } catch (readError) {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadXlsx();

    return () => {
      cancelled = true;
    };
  }, [previewKind, previewPath, readViaWorkspace, workspaceId, previewSrc, homeDirectory, expandedPreviewPath, effectiveWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    const container = pptxContainerRef.current;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    pptxPreviewerRef.current?.destroy();
    pptxPreviewerRef.current = null;
    if (!previewPath || previewKind !== "pptx") {
      return;
    }
    setError(null);
    setIsLoading(true);

    const loadPptx = async () => {
      try {
        const pathForReading = expandedPreviewPath ?? previewPath;
        const buffer = await loadPreviewArrayBuffer(
          workspaceId,
          readViaWorkspace,
          toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath),
          previewSrc,
          "PPTX",
        );

        if (cancelled || !pptxContainerRef.current || !buffer) {
          return;
        }
        const { init } = await import("pptx-preview");
        const previewer = init(pptxContainerRef.current, {
          width: Math.max(320, Math.floor(pptxContainerRef.current.clientWidth || 960)),
        });
        pptxPreviewerRef.current = previewer;
        await previewer.preview(buffer);
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPptx();

    return () => {
      cancelled = true;
      pptxPreviewerRef.current?.destroy();
      pptxPreviewerRef.current = null;
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [previewKind, previewPath, readViaWorkspace, workspaceId, previewSrc, homeDirectory, expandedPreviewPath, effectiveWorkspacePath]);

  useEffect(() => {
    let cancelled = false;
    setContent("");
    if (isDirectoryPreview || !previewPath || previewKind !== "text") {
      return () => {
        cancelled = true;
      };
    }
    setError(null);
    setIsLoading(true);
    const pathForReading = expandedPreviewPath ?? previewPath;
    const readText = readViaWorkspace && workspaceId
      ? readWorkspaceFile(workspaceId, toWorkspaceRelativePath(pathForReading, effectiveWorkspacePath)).then((response) => response.content ?? "")
      : isAbsolutePath(previewPath)
        ? readBinaryFilePath(pathForReading).then(binaryResponseToText)
        : Promise.reject(new Error("Workspace file preview is unavailable."));
    readText
      .then((response) => {
        if (!cancelled) {
          setContent(response);
        }
      })
      .catch((readError) => {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isDirectoryPreview, previewKind, previewPath, readViaWorkspace, workspaceId, expandedPreviewPath, effectiveWorkspacePath]);

  const previewLanguage = useMemo(() => languageFromPath(previewPath), [previewPath]);
  const shouldUseHighlightedPreview = useMemo(
    () => content.length <= HIGHLIGHT_MAX_CONTENT_LENGTH,
    [content.length],
  );
  const theme = useResolvedAppTheme();

  useEffect(() => {
    let cancelled = false;
    if (previewKind !== "text" || isMarkdownPreview || !shouldUseHighlightedPreview) {
      setHighlightedContentHtml("");
      return () => {
        cancelled = true;
      };
    }
    const cachedHtml = getCachedCodeBlockHtml(content, previewLanguage);
    if (cachedHtml) {
      setHighlightedContentHtml(cachedHtml);
    } else {
      setHighlightedContentHtml("");
    }
    highlightCodeBlockHtml(content || "Empty file.", previewLanguage).then((html) => {
      if (!cancelled) {
        setHighlightedContentHtml(html);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [content, isMarkdownPreview, previewKind, previewLanguage, shouldUseHighlightedPreview, theme]);

  const xlsxSheet = useMemo(() => {
    if (!xlsxSheetName) {
      return null;
    }
    return xlsxSheets.find((sheet) => sheet.name === xlsxSheetName) ?? null;
  }, [xlsxSheetName, xlsxSheets]);

  const xlsxRows = xlsxSheet?.rows ?? [];
  const xlsxColCount = xlsxSheet?.columnCount ?? 0;

  const xlsxHeaders = useMemo(() => {
    return Array.from({ length: xlsxColCount }, (_, index) => spreadsheetColumnLabel(index));
  }, [xlsxColCount]);

  if (isDirectoryPreview && fileTreeProps) {
    const isRootFileTreePreview = previewPath === FILE_TREE_PREVIEW_PATH;
    return (
      <PanelShell
        filePanelMode={filePanelMode}
        onFilePanelModeChange={onFilePanelModeChange}
        className="file-tree-panel file-preview-panel"
        headerClassName="git-panel-header file-preview-header"
        headerLeft={
          <FilePreviewTabBar
            paths={visiblePreviewTabs}
            activePath={previewPath}
            onPreviewPathChange={onPreviewPathChange}
            onPreviewTabClose={onPreviewTabClose}
          />
        }
      >
        {directoryError ? <div className="file-preview-error">{directoryError}</div> : null}
        <FileTreePanel
          {...fileTreeProps}
          workspacePath={isRootFileTreePreview ? fileTreeProps.workspacePath : directoryPreviewPath}
          files={isRootFileTreePreview ? fileTreeProps.files : directoryFiles}
          filePanelMode={filePanelMode}
          onFilePanelModeChange={onFilePanelModeChange}
          showPanelTabs={false}
          isLoading={isRootFileTreePreview ? fileTreeProps.isLoading : directoryLoading}
          onPreviewFile={(path) => fileTreeProps.onPreviewFile?.(path)}
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell
      filePanelMode={filePanelMode}
      onFilePanelModeChange={onFilePanelModeChange}
      className={`file-tree-panel file-preview-panel${
        previewKind === "pdf" ? " file-preview-panel--pdf" : ""
      }`}
      headerClassName="git-panel-header file-preview-header"
      headerLeft={
        <FilePreviewTabBar
          paths={visiblePreviewTabs}
          activePath={previewPath}
          onPreviewPathChange={onPreviewPathChange}
          onPreviewTabClose={onPreviewTabClose}
        />
      }
      headerRight={
        <PanelMeta className="file-tree-meta">
          {previewKind === "pdf" || previewKind === "docx" || previewKind === "xlsx" || previewKind === "pptx" ? (
            <div className="file-preview-zoom-controls">
              <button
                type="button"
                className="file-preview-zoom-button"
                onClick={() => {
                  if (previewKind === "pdf") {
                    setPdfZoom((current) => Math.max(25, current - 25));
                    return;
                  }
                  if (previewKind === "docx") {
                    setDocxZoom((current) => Math.max(25, current - 25));
                    return;
                  }
                  if (previewKind === "xlsx") {
                    setXlsxZoom((current) => Math.max(25, current - 25));
                    return;
                  }
                  setPptxZoom((current) => Math.max(25, current - 25));
                }}
                disabled={
                  previewKind === "pdf"
                    ? pdfZoom <= 25
                    : previewKind === "docx"
                      ? docxZoom <= 25
                      : previewKind === "xlsx"
                        ? xlsxZoom <= 25
                        : pptxZoom <= 25
                }
                aria-label={`Zoom out ${previewKind.toUpperCase()} preview`}
                title={`Zoom out ${previewKind.toUpperCase()} preview`}
              >
                <Minus size={12} aria-hidden />
              </button>
              <button
                type="button"
                className="file-preview-zoom-value"
                onClick={() => {
                  if (previewKind === "pdf") {
                    setPdfZoom(100);
                    return;
                  }
                  if (previewKind === "docx") {
                    setDocxZoom(100);
                    return;
                  }
                  if (previewKind === "xlsx") {
                    setXlsxZoom(100);
                    return;
                  }
                  setPptxZoom(100);
                }}
                aria-label={`Reset ${previewKind.toUpperCase()} zoom to 100%`}
                title={`Reset ${previewKind.toUpperCase()} zoom to 100%`}
              >
                {previewKind === "pdf"
                  ? pdfZoom
                  : previewKind === "docx"
                    ? docxZoom
                    : previewKind === "xlsx"
                      ? xlsxZoom
                      : pptxZoom}
                %
              </button>
              <button
                type="button"
                className="file-preview-zoom-button"
                onClick={() => {
                  if (previewKind === "pdf") {
                    setPdfZoom((current) => Math.min(250, current + 25));
                    return;
                  }
                  if (previewKind === "docx") {
                    setDocxZoom((current) => Math.min(250, current + 25));
                    return;
                  }
                  if (previewKind === "xlsx") {
                    setXlsxZoom((current) => Math.min(250, current + 25));
                    return;
                  }
                  setPptxZoom((current) => Math.min(250, current + 25));
                }}
                disabled={
                  previewKind === "pdf"
                    ? pdfZoom >= 250
                    : previewKind === "docx"
                      ? docxZoom >= 250
                      : previewKind === "xlsx"
                        ? xlsxZoom >= 250
                        : pptxZoom >= 250
                }
                aria-label={`Zoom in ${previewKind.toUpperCase()} preview`}
                title={`Zoom in ${previewKind.toUpperCase()} preview`}
              >
                <Plus size={12} aria-hidden />
              </button>
            </div>
          ) : null}
          {(previewKind === "pdf" || previewKind === "docx" || previewKind === "xlsx" || previewKind === "pptx") && workspacePath && previewPath ? (
            <button
              type="button"
              className="file-preview-external-button"
              onClick={async () => {
                const fullPath = joinWorkspacePath(effectiveWorkspacePath ?? workspacePath, previewPath);
                try {
                  await openPath(fullPath);
                } catch (e) {
                  console.error("Failed to open file:", e);
                }
              }}
              aria-label="Open in external application"
              title="Open in external application"
            >
              <ExternalLink size={14} aria-hidden />
            </button>
          ) : null}
        </PanelMeta>
      }
    >
      <div className="file-preview-panel-body">
        {!previewPath ? (
          <PreviewAddPanel
            onPickFile={handlePickPreviewFile}
            onOpenBrowser={handleOpenBrowserPreview}
            onSideChat={onPreviewSideChat}
            onTerminal={onPreviewTerminal}
            onOpenCanvas={() => onPreviewPathChange?.(CANVAS_PREVIEW_PATH)}
          />
        ) : isDiff ? (
          activeDiffEntry ? (
            <div className="agent-diff-preview-body agent-diff-preview-body--tab">
              <PierreDiffBlock
                diff={activeDiffEntry.diff}
                defaultExpanded
                displayPath={activeDiffEntry.displayPath ?? activeDiffEntry.path}
              />
            </div>
          ) : (
            <div className="file-preview-status file-preview-error">
              Diff preview unavailable.
            </div>
          )
        ) : isBrowser ? (
          <div className="file-preview-browser">
            <form className="file-preview-browser-bar" onSubmit={handleBrowserUrlSubmit}>
              <img
                className="file-preview-browser-bar-icon"
                src={MATERIAL_GOOGLE_ICON_URL}
                alt=""
                aria-hidden
              />
              <input
                type="text"
                inputMode="url"
                value={browserUrlInput}
                onBlur={handleBrowserUrlBlur}
                onChange={(event) => setBrowserUrlInput(event.target.value)}
                placeholder="https://example.com"
                aria-label="Website URL"
              />
              <button type="submit">Set</button>
              {browserUrl ? (
                <button type="button" onClick={() => void openUrl(browserUrl)}>
                  Open
                </button>
              ) : null}
            </form>
            {browserUrl ? (
              isPanelVisible ? (
                <TauriBrowserPreview
                  url={browserUrl}
                  isVisible={isPanelVisible}
                  onOpenExternal={() => void openUrl(browserUrl)}
                />
              ) : null
            ) : (
              <div className="file-preview-browser-empty">Enter a URL to open.</div>
            )}
          </div>
        ) : isTerminal && terminalState ? (
          <div className="file-preview-terminal">
            <TerminalPanel
              containerRef={terminalState.containerRef}
              status={terminalState.status}
              message={terminalState.message}
            />
          </div>
        ) : previewKind === "image" ? (
          isLoading ? (
            <div className="file-preview-status">Loading image preview...</div>
          ) : error ? (
            <div className="file-preview-status file-preview-error">{error}</div>
          ) : imageObjectUrl || previewSrc ? (
            <div className="file-preview-image file-preview-image--panel">
              <img src={imageObjectUrl || previewSrc} alt={fileTitle(previewPath)} />
            </div>
          ) : (
            <div className="file-preview-status file-preview-error">
              Image preview unavailable.
            </div>
          )
        ) : previewKind === "video" ? (
          isLoading ? (
            <div className="file-preview-status">Loading video preview...</div>
          ) : error ? (
            <div className="file-preview-status file-preview-error">{error}</div>
          ) : videoObjectUrl || previewSrc ? (
            <div className="file-preview-image file-preview-image--panel">
              <video
                src={videoObjectUrl || previewSrc}
                controls
                preload="metadata"
                className="file-preview-video"
              />
            </div>
          ) : (
            <div className="file-preview-status file-preview-error">
              Video preview unavailable.
            </div>
          )
        ) : previewKind === "pdf" ? (
          <div className="composer-attachment-doc-preview composer-attachment-doc-preview--panel">
            {isLoading ? (
              <div className="file-preview-status">Loading PDF preview...</div>
            ) : error ? (
              <div className="file-preview-status file-preview-error">{error}</div>
            ) : pdfPreviewFrameSrc ? (
              <iframe
                src={pdfPreviewFrameSrc}
                title={fileTitle(previewPath)}
                className="composer-attachment-doc-frame"
                style={{ width: "100%", height: "100%" }}
              />
            ) : null}
          </div>
        ) : previewKind === "docx" ? (
          <div className="file-preview-docx-panel" data-tauri-drag-region="false">
            {isLoading ? (
              <div className="file-preview-status">Loading DOCX preview...</div>
            ) : null}
            {error ? (
              <div className="file-preview-status file-preview-error">{error}</div>
            ) : null}
            <div className="file-preview-docx-scroll" data-tauri-drag-region="false">
              <div className="file-preview-docx-stage">
                <div
                  ref={docxContainerRef}
                  className={`file-preview-docx-renderer${isLoading ? " is-loading" : ""}`}
                  style={{ zoom: docxZoom / 100 } as CSSProperties}
                  data-tauri-drag-region="false"
                />
              </div>
            </div>
          </div>
        ) : previewKind === "xlsx" ? (
          <div className="file-preview-xlsx-panel">
            {isLoading ? (
              <div className="file-preview-status">Loading spreadsheet preview...</div>
            ) : null}
            {error ? <div className="file-preview-status file-preview-error">{error}</div> : null}
            {xlsxSheets.length ? (
              <>
                <div className="file-preview-xlsx-tabs" role="tablist" aria-label="Spreadsheet sheets">
                  {xlsxSheets.map((sheet) => (
                    <button
                      key={sheet.name}
                      type="button"
                      className={`file-preview-xlsx-tab${sheet.name === xlsxSheetName ? " is-active" : ""}`}
                      onClick={() => setXlsxSheetName(sheet.name)}
                      title={sheet.name}
                    >
                      {sheet.name}
                    </button>
                  ))}
                </div>
                <div className="file-preview-xlsx-scroll">
                  <div className="file-preview-xlsx-stage">
                    <div
                      className="file-preview-xlsx-renderer"
                      style={{ zoom: xlsxZoom / 100 } as CSSProperties}
                    >
                      <table className="file-preview-xlsx-table">
                        <thead>
                          <tr>
                            <th className="file-preview-xlsx-corner" />
                            {xlsxHeaders.map((header) => (
                              <th key={header}>{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {xlsxRows.length ? (
                            xlsxRows.map((row, rowIndex) => (
                              <tr key={`${xlsxSheetName}-${rowIndex}`}>
                                <th>{rowIndex + 1}</th>
                                {Array.from({ length: xlsxColCount }, (_, colIndex) => (
                                  <td key={`${xlsxSheetName}-${rowIndex}-${colIndex}`}>{row[colIndex] ?? ""}</td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={Math.max(1, xlsxColCount + 1)} className="file-preview-xlsx-empty">
                                Empty sheet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        ) : previewKind === "pptx" ? (
          <div className="file-preview-pptx-panel">
            {isLoading ? (
              <div className="file-preview-status">Loading PPTX preview...</div>
            ) : null}
            {error ? <div className="file-preview-status file-preview-error">{error}</div> : null}
            <div className="file-preview-pptx-scroll">
              <div className="file-preview-pptx-stage">
                <div
                  className="file-preview-pptx-renderer"
                  style={{ zoom: pptxZoom / 100 } as CSSProperties}
                >
                  <div ref={pptxContainerRef} className="file-preview-pptx-host" />
                </div>
              </div>
            </div>
          </div>
        ) : previewKind === "text" ? (
          isLoading ? (
            <div className="file-preview-status">Loading file...</div>
          ) : error ? (
            <div className="file-preview-status file-preview-error">{error}</div>
          ) : isMarkdownPreview ? (
            <div className="file-preview-panel-markdown markdown" data-tauri-drag-region="false">
              <Markdown
                value={content || "Empty file."}
                className="markdown"
                codeBlockStyle="message"
                workspacePath={workspacePath}
                showFilePath
              />
            </div>
          ) : (
            <div className="file-preview-code file-preview-code--panel">
              {shouldUseHighlightedPreview ? (
                highlightedContentHtml ? (
                  <div
                    className="file-preview-code-shiki"
                    style={{ WebkitUserSelect: "text", userSelect: "text" }}
                    dangerouslySetInnerHTML={{ __html: highlightedContentHtml }}
                  />
                ) : (
                  <div className="file-preview-code-fallback">
                    <div className="file-preview-status">Loading syntax highlight...</div>
                    <div className="file-preview-code-fallback-pre">
                      <PlainTextCodeWithLineNumbers value={content || "Empty file."} />
                    </div>
                  </div>
                )
              ) : (
                <div className="file-preview-code-fallback">
                  <div className="file-preview-status">
                    File is large, showing plain text fallback instead of syntax highlight.
                  </div>
                  <div className="file-preview-code-fallback-pre">
                    <PlainTextCodeWithLineNumbers value={content || "Empty file."} />
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="file-preview-status file-preview-error">
            Preview unavailable for this file type.
          </div>
        )}
      </div>
    </PanelShell>
  );
}
