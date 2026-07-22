import {
  isValidElement,
  Children,
  memo,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
  type MouseEvent,
} from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Copy from "lucide-react/dist/esm/icons/copy";
import { convertFileSrc } from "@tauri-apps/api/core";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listDirectoryFiles, readImageAsDataUrl } from "@services/tauri";
import { pushSuccessToast } from "@services/toasts";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { getFileTypeIconUrl } from "@/utils/fileTypeIcons";
import { isAbsolutePath, joinWorkspacePath } from "@/utils/platformPaths";
import {
  describeFileTarget,
  formatParsedFileLocation,
  isFileLinkUrl,
  parseFileLinkUrl,
  parseInlineFileTarget,
  remarkFileLinks,
  resolveMessageFileHref,
  toFileLink,
} from "../utils/messageFileLinks";
import {
  getCachedCodeBlockHtml,
  getFallbackCodeBlockHtml,
  highlightCodeBlockHtml,
} from "../utils/shiki";
import { useResolvedAppTheme } from "../utils/useResolvedAppTheme";
import { parseFileLocation, type ParsedFileLocation } from "../../../utils/fileLinks";
import { ImageLightbox } from "./MessageRows";

type MarkdownProps = {
  value: string;
  className?: string;
  codeBlock?: boolean;
  codeBlockStyle?: "default" | "message";
  codeBlockCopyUseModifier?: boolean;
  enableCollapse?: boolean;
  completeUnclosedCodeFences?: boolean;
  normalizeTightHeadings?: boolean;
  enableRichLinks?: boolean;
  showFilePath?: boolean;
  workspacePath?: string | null;
  onOpenFileLink?: (path: ParsedFileLocation) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onOpenThreadLink?: (threadId: string) => void;
  onPreviewFile?: (path: string, kind?: "file" | "folder") => void;
};

type CodeBlockProps = {
  className?: string;
  value: string;
  copyUseModifier: boolean;
};

type PreProps = {
  node?: {
    tagName?: string;
    children?: Array<{
      tagName?: string;
      properties?: { className?: string[] | string };
      children?: Array<{ value?: string }>;
    }>;
  };
  children?: ReactNode;
  copyUseModifier: boolean;
};

type LinkBlockProps = {
  urls: string[];
};

const COLLAPSIBLE_MARKDOWN_MAX_HEIGHT = 240;
const COLLAPSIBLE_MARKDOWN_HYSTERESIS_PX = 24;
const CODE_HIGHLIGHT_DEBOUNCE_MS = 220;
const REMARK_PLUGINS = [remarkGfm, remarkFileLinks, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

const IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const MARKDOWN_INLINE_IMAGE_EXTENSIONS = new Set(
  [...IMAGE_EXTENSIONS].filter((extension) => extension !== "webp"),
);

const TEXT_FILE_EXTENSIONS = new Set([
  "astro",
  "bash",
  "c",
  "cc",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "cxx",
  "dart",
  "diff",
  "env",
  "go",
  "graphql",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "less",
  "log",
  "lua",
  "m",
  "md",
  "mdx",
  "mm",
  "patch",
  "php",
  "plist",
  "properties",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const MATERIAL_FOLDER_ICON_URL = "/assets/material-icons/folder.svg";
const markdownImagePreloadCache = new Map<string, Promise<void>>();
const markdownLocalImageDataUrlCache = new Map<string, string>();
const markdownLocalImagePendingCache = new Map<string, Promise<string>>();
const markdownLocalImageMissingCache = new Set<string>();

function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  if (!match) {
    return null;
  }
  return match[1];
}

function extractCodeClassNameFromChildren(children?: ReactNode) {
  let result: string | undefined;
  Children.forEach(children, (child) => {
    if (result || !isValidElement<{ className?: string }>(child)) {
      return;
    }
    const className = child.props.className;
    if (typeof className === "string" && className.trim()) {
      result = className;
    }
  });
  return result;
}

function extractCodeFromPre(node?: PreProps["node"], children?: ReactNode) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  const className = codeNode?.properties?.className;
  const normalizedClassName = Array.isArray(className)
    ? className.join(" ")
    : className;
  const nodeValue =
    codeNode?.children?.map((child) => child.value ?? "").join("") ?? "";
  const value = nodeValue || textFromReactNode(children);
  return {
    className: normalizedClassName ?? extractCodeClassNameFromChildren(children),
    value: value.replace(/\n$/, ""),
  };
}

function fileExtension(path: string) {
  const normalized = path.replace(/\\/g, "/").split(/[?#]/, 1)[0] ?? path;
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  const lastDotIndex = fileName.lastIndexOf(".");
  return lastDotIndex > 0 ? fileName.slice(lastDotIndex + 1).toLowerCase() : "";
}

function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/").split(/[?#]/, 1)[0] ?? path;
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1).trim();
  if (!fileName) {
    return "";
  }
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function isRenderableImageUrl(url: string) {
  if (/^data:image\//i.test(url)) {
    return !/^data:image\/webp[;,]/i.test(url);
  }
  if (!/^https?:\/\//i.test(url)) {
    return false;
  }
  return MARKDOWN_INLINE_IMAGE_EXTENSIONS.has(fileExtension(url));
}

function isImageFilePath(path: string) {
  return IMAGE_EXTENSIONS.has(fileExtension(path));
}

function isMarkdownInlineImageFilePath(path: string) {
  return MARKDOWN_INLINE_IMAGE_EXTENSIONS.has(fileExtension(path));
}

function isPathLikeLinkLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed.startsWith("file://") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    /[\\/]/.test(trimmed)
  );
}

function resolveMarkdownImageSrc(url: string, workspacePath: string | null) {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  if (/^data:image\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return isRenderableImageUrl(trimmed) ? trimmed : "";
  }
  const resolvedFilePath =
    parseFileLinkUrl(trimmed) ?? resolveMessageFileHref(trimmed, workspacePath);
  if (!resolvedFilePath) {
    return "";
  }
  if (!isMarkdownInlineImageFilePath(resolvedFilePath.path)) {
    return "";
  }
  try {
    const absolutePath =
      workspacePath && !isAbsolutePath(resolvedFilePath.path)
        ? joinWorkspacePath(workspacePath, resolvedFilePath.path)
        : resolvedFilePath.path;
    return convertFileSrc(absolutePath);
  } catch {
    return "";
  }
}

function preloadMarkdownImageSrc(src: string) {
  const trimmed = src.trim();
  if (!trimmed || markdownImagePreloadCache.has(trimmed)) {
    return markdownImagePreloadCache.get(trimmed) ?? Promise.resolve();
  }
  const promise = new Promise<void>((resolve) => {
    const image = new window.Image();
    image.src = trimmed;
    const decoded = image.decode?.();
    if (decoded) {
      void decoded.then(
        () => resolve(),
        () => resolve(),
      );
      return;
    }
    image.onload = () => resolve();
    image.onerror = () => resolve();
  });
  markdownImagePreloadCache.set(trimmed, promise);
  return promise;
}

function loadMarkdownLocalImageDataUrl(path: string) {
  if (markdownLocalImageMissingCache.has(path)) {
    return Promise.resolve("");
  }
  const cached = markdownLocalImageDataUrlCache.get(path);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = markdownLocalImagePendingCache.get(path);
  if (pending) {
    return pending;
  }
  const request = readImageAsDataUrl(path).then(
    (dataUrl) => {
      markdownLocalImagePendingCache.delete(path);
      if (dataUrl) {
        markdownLocalImageDataUrlCache.set(path, dataUrl);
      } else {
        markdownLocalImageMissingCache.add(path);
      }
      return dataUrl;
    },
    () => {
      markdownLocalImagePendingCache.delete(path);
      markdownLocalImageMissingCache.add(path);
      return "";
    },
  );
  markdownLocalImagePendingCache.set(path, request);
  return request;
}

function extractStandaloneMarkdownImageUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const markdownImageMatch = trimmed.match(/^!\[[^\]]*]\(([^)\n]+)\)$/);
  if (markdownImageMatch) {
    const url = markdownImageMatch[1].trim();
    return resolveMessageFileHref(url, null)?.path
      ? isMarkdownInlineImageFilePath(resolveMessageFileHref(url, null)!.path) ? url : null
      : isRenderableImageUrl(url) ? url : null;
  }
  const emptyLinkMatch = trimmed.match(/^\[\]\(([^)\n]+)\)$/);
  if (emptyLinkMatch) {
    const url = emptyLinkMatch[1].trim();
    return resolveMessageFileHref(url, null)?.path
      ? isMarkdownInlineImageFilePath(resolveMessageFileHref(url, null)!.path) ? url : null
      : isRenderableImageUrl(url) ? url : null;
  }
  return null;
}

function containsRenderableMarkdownImage(value: string) {
  const matches = value.match(/!\[[^\]]*]\(([^)\n]+)\)|\[\]\(([^)\n]+)\)/g);
  if (!matches) {
    return false;
  }
  return matches.some((match) => {
    const urlMatch = match.match(/\(([^)\n]+)\)$/);
    if (!urlMatch) {
      return false;
    }
    const url = urlMatch[1].trim();
    const resolved = resolveMessageFileHref(url, null);
    if (resolved?.path) {
      return isMarkdownInlineImageFilePath(resolved.path);
    }
    return isRenderableImageUrl(url);
  });
}

function resolveMarkdownImagePreviewKey(url: string, workspacePath: string | null) {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  if (/^data:image\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return isRenderableImageUrl(trimmed) ? trimmed : "";
  }
  const resolvedFilePath =
    parseFileLinkUrl(trimmed) ?? resolveMessageFileHref(trimmed, workspacePath);
  if (!resolvedFilePath || !isMarkdownInlineImageFilePath(resolvedFilePath.path)) {
    return "";
  }
  return workspacePath && !isAbsolutePath(resolvedFilePath.path)
    ? joinWorkspacePath(workspacePath, resolvedFilePath.path)
    : resolvedFilePath.path;
}

function collectRenderableMarkdownImagePreviewKeys(value: string, workspacePath: string | null) {
  const matches = value.match(/!\[[^\]]*]\(([^)\n]+)\)|\[\]\(([^)\n]+)\)/g);
  if (!matches) {
    return new Set<string>();
  }
  const keys = new Set<string>();
  for (const match of matches) {
    const urlMatch = match.match(/\(([^)\n]+)\)$/);
    if (!urlMatch) {
      continue;
    }
    const key = resolveMarkdownImagePreviewKey(urlMatch[1].trim(), workspacePath);
    if (key) {
      keys.add(key);
    }
  }
  return keys;
}

function isTextFileTarget(target: ParsedFileLocation) {
  const ext = fileExtension(target.path);
  if (ext) {
    return TEXT_FILE_EXTENSIONS.has(ext);
  }
  return target.line !== null;
}

function isFolderTarget(target: ParsedFileLocation) {
  return !fileExtension(target.path) && target.line === null;
}

function resolveDirectoryProbePath(path: string, workspacePath: string | null) {
  if (isAbsolutePath(path) || !workspacePath) {
    return path;
  }
  return `${workspacePath.replace(/[\\/]+$/, "")}/${path.replace(/^[\\/]+/, "")}`;
}

async function isDirectoryTarget(path: string, workspacePath: string | null) {
  try {
    await listDirectoryFiles(resolveDirectoryProbePath(path, workspacePath));
    return true;
  } catch {
    return false;
  }
}

function textFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textFromReactNode).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromReactNode(node.props.children);
  }
  return "";
}

function countTableColumns(node: ReactNode): number {
  let maxColumns = 0;
  const visit = (value: ReactNode) => {
    Children.forEach(value, (child) => {
      if (!isValidElement(child)) {
        return;
      }
      const props = child.props as { children?: ReactNode; colSpan?: number } | null;
      const elementType =
        typeof child.type === "string" ? child.type.toLowerCase() : "";
      if (elementType === "tr") {
        let columnCount = 0;
        Children.forEach(props?.children, (cell) => {
          if (!isValidElement(cell)) {
            return;
          }
          const cellProps = cell.props as { colSpan?: number } | null;
          const cellType = typeof cell.type === "string" ? cell.type.toLowerCase() : "";
          if (cellType !== "th" && cellType !== "td") {
            return;
          }
          const colSpanValue = Number(cellProps?.colSpan ?? 1);
          columnCount += Number.isFinite(colSpanValue) && colSpanValue > 0 ? colSpanValue : 1;
        });
        maxColumns = Math.max(maxColumns, columnCount);
        return;
      }
      if (props?.children !== undefined) {
        visit(props.children);
      }
    });
  };
  visit(node);
  return maxColumns;
}

function mergeLineFromLinkText(
  target: ParsedFileLocation,
  children: ReactNode,
): ParsedFileLocation {
  if (target.line !== null) {
    return target;
  }
  const linkText = textFromReactNode(children).trim();
  const textTarget = parseInlineFileTarget(linkText) ?? parseFileLocation(linkText);
  if (!textTarget || textTarget.line === null) {
    return target;
  }
  const normalizedTargetPath = target.path.replace(/\\/g, "/");
  const normalizedTextPath = textTarget.path.replace(/\\/g, "/");
  const targetFileName = normalizedTargetPath.slice(normalizedTargetPath.lastIndexOf("/") + 1);
  const textFileName = normalizedTextPath.slice(normalizedTextPath.lastIndexOf("/") + 1);
  if (
    normalizedTextPath === targetFileName ||
    textFileName === targetFileName ||
    normalizedTextPath === normalizedTargetPath ||
    normalizedTargetPath.endsWith(`/${normalizedTextPath}`) ||
    normalizedTextPath.endsWith(`/${normalizedTargetPath}`)
  ) {
    return {
      path: target.path,
      line: textTarget.line,
      column: textTarget.column,
    };
  }
  return target;
}

function appendLineLabelToLinkText(label: string, lineLabel: string) {
  return /(?:\(\s*line\s+\d+(?::\d+)?\s*\)|[（(]?\s*(?:第\s*)?\d+\s*行\s*[）)]?)$/i.test(
    label,
  )
    ? label
    : `${label} (line ${lineLabel})`;
}

function appendLineToFileHref(href: string, lineLabel: string) {
  const target = resolveMessageFileHref(href, null);
  if (!target || target.line !== null) {
    return href;
  }
  return toFileLink({
    path: target.path,
    line: Number.parseInt(lineLabel.split(":", 1)[0], 10),
    column: lineLabel.includes(":")
      ? Number.parseInt(lineLabel.slice(lineLabel.indexOf(":") + 1), 10)
      : null,
  });
}

function normalizeTrailingLineLabel(lineLabel: string) {
  const hashMatch = lineLabel.match(/^#L(\d+)(?:C(\d+))?$/i);
  if (hashMatch) {
    return `${hashMatch[1]}${hashMatch[2] ? `:${hashMatch[2]}` : ""}`;
  }
  const lineWordMatch = lineLabel.match(/^line\s+(\d+(?::\d+)?)$/i);
  if (lineWordMatch) {
    return lineWordMatch[1];
  }
  const cnMatch = lineLabel.match(/^(?:第\s*)?(\d+)\s*行$/i);
  if (cnMatch) {
    return cnMatch[1];
  }
  return lineLabel.replace(/^:/, "");
}

function normalizeFileLinkLineLabels(value: string) {
  return value.replace(
    /\[([^\]\n]+)\]\(([^)\n]+)\)\s*(?:\(\s*(line\s+\d+(?::\d+)?|#L\d+(?:C\d+)?|(?:第\s*)?\d+\s*行)\s*\)|(:\d+(?::\d+)?|#L\d+(?:C\d+)?|line\s+\d+(?::\d+)?|(?:第\s*)?\d+\s*行))/gi,
    (
      match,
      label: string,
      href: string,
      parenthesizedLineLabel: string | undefined,
      bareLineLabel: string | undefined,
    ) => {
      const lineLabel = normalizeTrailingLineLabel(
        (parenthesizedLineLabel ?? bareLineLabel ?? "").trim(),
      );
      if (!lineLabel) {
        return match;
      }
      const nextHref = appendLineToFileHref(href.trim(), lineLabel);
      if (nextHref === href.trim() && !resolveMessageFileHref(href.trim(), null)) {
        return match;
      }
      return `[${appendLineLabelToLinkText(label, lineLabel)}](${nextHref})`;
    },
  );
}

function normalizeUrlLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBullet = trimmed.replace(/^(?:[-*]|\d+\.)\s+/, "");
  if (!/^https?:\/\/\S+$/i.test(withoutBullet)) {
    return null;
  }
  return withoutBullet;
}

type StructuredReviewFinding = {
  file: string;
  category: string;
  finding: string;
  recommendation: string;
  severity: string;
};

function escapeTableCell(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br />")
    .trim();
}

function parseStructuredReviewFinding(line: string): StructuredReviewFinding | null {
  const parts = line.split(/\s+\|\s+/).map((part) => part.trim());
  if (parts.length !== 5) {
    return null;
  }
  const [file, rawCategory, finding, recommendation, rawSeverity] = parts;
  if (!file || !finding || !recommendation || !/^category=/i.test(rawCategory)) {
    return null;
  }
  const category = rawCategory.replace(/^category=/i, "").trim();
  const severity = rawSeverity.replace(/^severity=/i, "").trim();
  if (!category || !severity) {
    return null;
  }
  if (!/^(critical|high|medium|low|info|warning|error)$/i.test(severity)) {
    return null;
  }
  return {
    file,
    category,
    finding,
    recommendation,
    severity,
  };
}

function buildStructuredReviewTable(rows: StructuredReviewFinding[]) {
  const header = [
    "| File | Category | Finding | Recommendation | Severity |",
    "| --- | --- | --- | --- | --- |",
  ];
  const body = rows.map(
    ({ file, category, finding, recommendation, severity }) =>
      `| \`${escapeTableCell(file)}\` | ${escapeTableCell(category)} | ${escapeTableCell(
        finding,
      )} | ${escapeTableCell(recommendation)} | ${escapeTableCell(severity)} |`,
  );
  return [...header, ...body].join("\n");
}

function normalizeStructuredReviewTables(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let pendingRows: StructuredReviewFinding[] = [];
  const output: string[] = [];

  const flushPendingRows = () => {
    if (pendingRows.length === 0) {
      return;
    }
    if (output.length > 0 && output[output.length - 1].trim()) {
      output.push("");
    }
    output.push(buildStructuredReviewTable(pendingRows));
    output.push("");
    pendingRows = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      flushPendingRows();
      inFence = !inFence;
      output.push(line);
      continue;
    }
    const structuredRow = inFence ? null : parseStructuredReviewFinding(line);
    if (structuredRow) {
      pendingRows.push(structuredRow);
      continue;
    }
    if (!inFence && pendingRows.length > 0 && !line.trim()) {
      continue;
    }
    flushPendingRows();
    output.push(line);
  }

  flushPendingRows();
  return output.join("\n");
}

function stripTrailingMemoryCitation(value: string) {
  return value.replace(/\n*<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>\s*$/i, "").trim();
}

export function isStandaloneMarkdownTable(value: string) {
  const stripped = stripTrailingMemoryCitation(value);
  if (!stripped) {
    return false;
  }
  const normalized = normalizeStructuredReviewTables(normalizeListIndentation(stripped)).trim();
  if (!normalized) {
    return false;
  }
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return false;
  }
  return lines.every((line) => /^\|.*\|\s*$/.test(line.trim()));
}

function extractUrlLines(value: string) {
  const lines = value.split(/\r?\n/);
  const urls = lines
    .map((line) => normalizeUrlLine(line))
    .filter((line): line is string => Boolean(line));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return null;
  }
  if (urls.length !== nonEmptyLines.length) {
    return null;
  }
  return urls;
}

function normalizeListIndentation(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let activeOrderedItem = false;
  let orderedBaseIndent = 4;
  let orderedIndentOffset: number | null = null;

  const countLeadingSpaces = (line: string) =>
    line.match(/^\s*/)?.[0].length ?? 0;
  const spaces = (count: number) => " ".repeat(Math.max(0, count));
  const normalized = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      inFence = !inFence;
      activeOrderedItem = false;
      orderedIndentOffset = null;
      return line;
    }
    if (inFence) {
      return line;
    }
    if (!line.trim()) {
      return line;
    }

    const orderedMatch = line.match(/^(\s*)\d+\.\s+/);
    if (orderedMatch) {
      const rawIndent = orderedMatch[1].length;
      const normalizedIndent =
        rawIndent > 0 && rawIndent < 4 ? 4 : rawIndent;
      activeOrderedItem = true;
      orderedBaseIndent = normalizedIndent + 4;
      orderedIndentOffset = null;
      if (normalizedIndent !== rawIndent) {
        return `${spaces(normalizedIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch) {
      const rawIndent = bulletMatch[1].length;
      let targetIndent = rawIndent;

      if (!activeOrderedItem && rawIndent > 0 && rawIndent < 4) {
        targetIndent = 4;
      }

      if (activeOrderedItem) {
        if (orderedIndentOffset === null && rawIndent < orderedBaseIndent) {
          orderedIndentOffset = orderedBaseIndent - rawIndent;
        }
        if (orderedIndentOffset !== null) {
          const adjustedIndent = rawIndent + orderedIndentOffset;
          if (adjustedIndent <= orderedBaseIndent + 12) {
            targetIndent = adjustedIndent;
          }
        }
      }

      if (targetIndent !== rawIndent) {
        return `${spaces(targetIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const leadingSpaces = countLeadingSpaces(line);
    if (activeOrderedItem && leadingSpaces < orderedBaseIndent) {
      activeOrderedItem = false;
      orderedIndentOffset = null;
    }
    return line;
  });
  return normalized.join("\n");
}

function normalizeTightMarkdownHeadings(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(```|~~~)/);
      if (fenceMatch) {
        inFence = !inFence;
        return line;
      }
      if (inFence) {
        return line;
      }
      return line.replace(/^(\s{0,3}#{1,6})(?=\S)(?!#)/, "$1 ");
    })
    .join("\n");
}

function completeTrailingCodeFence(value: string) {
  const lines = value.split(/\r?\n/);
  let activeFence: { marker: string; length: number } | null = null;
  for (const line of lines) {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (!match) {
      continue;
    }
    const fence = match[1];
    const marker = fence[0];
    if (!activeFence) {
      activeFence = { marker, length: fence.length };
      continue;
    }
    if (marker === activeFence.marker && fence.length >= activeFence.length) {
      activeFence = null;
    }
  }
  if (!activeFence) {
    return value;
  }
  const closingFence = activeFence.marker.repeat(activeFence.length);
  return value.endsWith("\n") ? `${value}${closingFence}` : `${value}\n${closingFence}`;
}

function LinkBlock({ urls }: LinkBlockProps) {
  return (
    <div className="markdown-linkblock">
      {urls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {url}
        </a>
      ))}
    </div>
  );
}

const brokenImageSrcSet = new Set<string>();

function InlineImagePreview({
  src,
  alt,
  sourcePath,
  onOpen,
}: {
  src: string;
  alt: string;
  sourcePath?: string;
  onOpen: () => void;
}) {
  const [currentSrc, setCurrentSrc] = useState(() =>
    sourcePath &&
    !sourcePath.startsWith("data:") &&
    !sourcePath.startsWith("http://") &&
    !sourcePath.startsWith("https://")
      ? (markdownLocalImageDataUrlCache.get(sourcePath) ?? "")
      : src,
  );
  const [errored, setErrored] = useState(() => brokenImageSrcSet.has(src));
  const [didFallback, setDidFallback] = useState(false);
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(
      sourcePath &&
      !sourcePath.startsWith("data:") &&
      !sourcePath.startsWith("http://") &&
      !sourcePath.startsWith("https://") &&
      !markdownLocalImageDataUrlCache.has(sourcePath) &&
      !markdownLocalImageMissingCache.has(sourcePath),
    ),
  );

  useEffect(() => {
    setErrored(brokenImageSrcSet.has(src));
    setDidFallback(false);
    if (
      !sourcePath ||
      sourcePath.startsWith("data:") ||
      sourcePath.startsWith("http://") ||
      sourcePath.startsWith("https://")
    ) {
      setCurrentSrc(src);
      setIsLoading(false);
      return;
    }
    if (markdownLocalImageMissingCache.has(sourcePath)) {
      brokenImageSrcSet.add(src);
      setCurrentSrc("");
      setErrored(true);
      setIsLoading(false);
      return;
    }
    const cached = markdownLocalImageDataUrlCache.get(sourcePath);
    if (cached) {
      setCurrentSrc(cached);
      setIsLoading(false);
      return;
    }
    let isCancelled = false;
    setIsLoading(true);
    void loadMarkdownLocalImageDataUrl(sourcePath).then(
      (dataUrl) => {
        if (isCancelled) {
          return;
        }
        if (!dataUrl) {
          brokenImageSrcSet.add(src);
          setCurrentSrc("");
          setErrored(true);
          setIsLoading(false);
          return;
        }
        setCurrentSrc(dataUrl);
        setErrored(false);
        setIsLoading(false);
      },
      () => {
        if (isCancelled) {
          return;
        }
        brokenImageSrcSet.add(src);
        setCurrentSrc("");
        setErrored(true);
        setIsLoading(false);
      },
    );
    return () => {
      isCancelled = true;
    };
  }, [sourcePath, src]);

  const handleActivate = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    if (!errored && !isLoading) {
      onOpen();
    }
  };

  if (isLoading) {
    return <span className="markdown-inline-image-placeholder" aria-hidden="true" />;
  }

  if (errored) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="markdown-inline-image-button is-error"
        onClick={handleActivate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            handleActivate(event);
          }
        }}
        aria-label="Open image preview"
      >
        <span className="markdown-inline-image-fallback">{alt || "image"}</span>
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className="markdown-inline-image-button"
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleActivate(event);
        }
      }}
      aria-label="Open image preview"
    >
      <img
        src={currentSrc}
        alt={alt}
        loading="eager"
        decoding="sync"
        onError={() => {
          if (
            didFallback ||
            !sourcePath ||
            sourcePath.startsWith("data:") ||
            sourcePath.startsWith("http://") ||
            sourcePath.startsWith("https://")
          ) {
            brokenImageSrcSet.add(src);
            setErrored(true);
            return;
          }
          setDidFallback(true);
          void readImageAsDataUrl(sourcePath).then(
            (dataUrl) => {
              if (!dataUrl) {
                brokenImageSrcSet.add(src);
                setErrored(true);
                return;
              }
              setCurrentSrc(dataUrl);
              setErrored(false);
            },
            () => {
              brokenImageSrcSet.add(src);
              setErrored(true);
            },
          );
        }}
      />
    </span>
  );
}


function FileReferenceLink({
  href,
  rawPath,
  workspacePath,
  imagePreviewSrc,
  imagePreviewSourcePath,
  onClick,
  onContextMenu,
  onOpenImagePreview,
}: {
  href: string;
  rawPath: ParsedFileLocation;
  workspacePath?: string | null;
  imagePreviewSrc?: string;
  imagePreviewSourcePath?: string;
  onClick: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onContextMenu: (event: React.MouseEvent, path: ParsedFileLocation) => void;
  onOpenImagePreview?: (src: string, alt: string, sourcePath?: string) => void;
}) {
  const { fileName, lineLabel } = describeFileTarget(rawPath, workspacePath);
  const isFolder = isFolderTarget(rawPath);
  const fileIconUrl = isFolder ? MATERIAL_FOLDER_ICON_URL : getFileTypeIconUrl(rawPath.path);
  const detailLabel = lineLabel ? `(line ${lineLabel})` : null;
  const compactLink = (
    <a
      href={href}
      className="message-file-link message-file-link-compact ds-tooltip-trigger"
      data-tooltip={rawPath.path}
      data-tooltip-align="start"
      onClick={(event) => onClick(event, rawPath)}
      onContextMenu={(event) => onContextMenu(event, rawPath)}
    >
      <span
        className="message-file-link-file-icon"
        aria-hidden
      >
        <img src={fileIconUrl} alt="" aria-hidden />
      </span>
      <span className="message-file-link-name">{fileName}</span>
      {detailLabel ? (
        <span className="message-file-link-line">{detailLabel}</span>
      ) : null}
    </a>
  );
  if (!imagePreviewSrc || !onOpenImagePreview || isFolder) {
    return compactLink;
  }
  return (
    <span className="message-file-link-preview-stack">
      {compactLink}
      <span className="message-file-link-image-preview">
        <InlineImagePreview
          src={imagePreviewSrc}
          alt={fileName}
          sourcePath={imagePreviewSourcePath}
          onOpen={() => onOpenImagePreview(imagePreviewSrc, fileName, imagePreviewSourcePath)}
        />
      </span>
    </span>
  );
}

function toAbsolutePreviewPath(path: string, workspacePath: string | null) {
  if (!path) {
    return undefined;
  }
  return workspacePath && !isAbsolutePath(path) ? joinWorkspacePath(workspacePath, path) : path;
}

const CodeBlock = memo(function CodeBlock({
  className,
  value,
  copyUseModifier,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const languageTag = extractLanguageTag(className);
  const theme = useResolvedAppTheme();
  const [highlightedHtml, setHighlightedHtml] = useState(() => {
    return getCachedCodeBlockHtml(value, languageTag) || getFallbackCodeBlockHtml(value);
  });
  const languageLabel = languageTag ?? "Code";
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const cachedHtml = getCachedCodeBlockHtml(value, languageTag);
    if (cachedHtml) {
      setHighlightedHtml(cachedHtml);
      return undefined;
    }
    setHighlightedHtml(getFallbackCodeBlockHtml(value));
    let isActive = true;
    const highlightTimeout = window.setTimeout(() => {
      void highlightCodeBlockHtml(value, languageTag).then((html) => {
        if (isActive) {
          setHighlightedHtml(html);
        }
      });
    }, CODE_HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(highlightTimeout);
    };
  }, [languageTag, value, theme]);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    try {
      const shouldFence = copyUseModifier ? event.altKey : true;
      const nextValue = shouldFence ? fencedValue : value;
      await navigator.clipboard.writeText(nextValue);
      pushSuccessToast({
        title: "Copied",
        message: "Copy successful.",
        durationMs: 3000,
      });
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 3000);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <button
          type="button"
          className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label="Copy code block"
          title={copied ? "Copied" : "Copy"}
        >
          <Copy size={13} aria-hidden />
        </button>
      </div>
      <div
        className="markdown-codeblock-body"
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    </div>
  );
});

const InlineCodeBlock = memo(function InlineCodeBlock({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  const languageTag = extractLanguageTag(className);
  const theme = useResolvedAppTheme();
  const [highlightedHtml, setHighlightedHtml] = useState(() => {
    return getCachedCodeBlockHtml(value, languageTag) || getFallbackCodeBlockHtml(value);
  });

  useEffect(() => {
    const cachedHtml = getCachedCodeBlockHtml(value, languageTag);
    if (cachedHtml) {
      setHighlightedHtml(cachedHtml);
      return undefined;
    }
    setHighlightedHtml(getFallbackCodeBlockHtml(value));
    let isActive = true;
    const highlightTimeout = window.setTimeout(() => {
      void highlightCodeBlockHtml(value, languageTag).then((html) => {
        if (isActive) {
          setHighlightedHtml(html);
        }
      });
    }, CODE_HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      isActive = false;
      window.clearTimeout(highlightTimeout);
    };
  }, [languageTag, value, theme]);

  return (
    <div
      className="markdown-codeblock-single"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
});

const PreBlock = memo(function PreBlock({ node, children, copyUseModifier }: PreProps) {
  const { className, value } = extractCodeFromPre(node, children);
  if (!className && !value && children) {
    return <pre>{children}</pre>;
  }
  const urlLines = extractUrlLines(value);
  if (urlLines) {
    return <LinkBlock urls={urlLines} />;
  }
  const isSingleLine = !value.includes("\n");
  if (isSingleLine) {
    return <InlineCodeBlock className={className} value={value} />;
  }
  return (
    <CodeBlock
      className={className}
      value={value}
      copyUseModifier={copyUseModifier}
    />
  );
});

export const Markdown = memo(function Markdown({
  value,
  className,
  codeBlock,
  codeBlockStyle = "default",
  codeBlockCopyUseModifier = false,
  enableCollapse = false,
  completeUnclosedCodeFences = false,
  normalizeTightHeadings = false,
  enableRichLinks = true,
  workspacePath = null,
  onOpenFileLink,
  onOpenFileLinkMenu,
  onOpenThreadLink,
  onPreviewFile,
}: MarkdownProps) {
  const { t } = useI18nSafe();
  const deferredValue = useDeferredValue(value);
  const markdownValue = completeUnclosedCodeFences || normalizeTightHeadings
    ? value
    : deferredValue;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{
    src: string;
    alt: string;
    sourcePath?: string;
  } | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(enableCollapse);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const imageSrcCacheRef = useRef(new Map<string, string>());
  const contentRef = useRef<HTMLDivElement | null>(null);
  const normalizedInlineValue = useMemo(
    () => {
      const headingNormalized = normalizeTightHeadings
        ? normalizeTightMarkdownHeadings(markdownValue)
        : markdownValue;
      return normalizeFileLinkLineLabels(
        normalizeStructuredReviewTables(normalizeListIndentation(headingNormalized)),
      );
    },
    [markdownValue, normalizeTightHeadings],
  );
  const standaloneImageUrl = useMemo(
    () => extractStandaloneMarkdownImageUrl(normalizedInlineValue),
    [normalizedInlineValue],
  );
  const hasRenderableMarkdownImage = useMemo(
    () =>
      standaloneImageUrl !== null || containsRenderableMarkdownImage(normalizedInlineValue),
    [normalizedInlineValue, standaloneImageUrl],
  );
  const markdownImagePreviewKeys = useMemo(
    () => collectRenderableMarkdownImagePreviewKeys(normalizedInlineValue, workspacePath),
    [normalizedInlineValue, workspacePath],
  );
  const shouldRenderCodeBlock = Boolean(codeBlock && !hasRenderableMarkdownImage);
  const normalizedValue = shouldRenderCodeBlock ? markdownValue : normalizedInlineValue;
  const content = useMemo(
    () => {
      if (shouldRenderCodeBlock) {
        return `\`\`\`\n${normalizedValue}\n\`\`\``;
      }
      return completeUnclosedCodeFences
        ? completeTrailingCodeFence(normalizedValue)
        : normalizedValue;
    },
    [completeUnclosedCodeFences, normalizedValue, shouldRenderCodeBlock],
  );
  const handleFileLinkClick = useCallback((event: React.MouseEvent, path: ParsedFileLocation) => {
    event.preventDefault();
    event.stopPropagation();
    if (onPreviewFile) {
      void isDirectoryTarget(path.path, workspacePath).then((isDirectory) => {
        onPreviewFile(path.path, isDirectory ? "folder" : "file");
      });
      return;
    }
    onOpenFileLink?.(path);
  }, [onOpenFileLink, onPreviewFile, workspacePath]);
  const handleLocalLinkClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const openWebLink = useCallback((event: React.MouseEvent, url: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (onPreviewFile && /^https?:\/\//i.test(url)) {
      onPreviewFile(`browser:${url}`, "file");
      return;
    }
    void openUrl(url);
  }, [onPreviewFile]);
  const handleFileLinkContextMenu = useCallback((
    event: React.MouseEvent,
    path: ParsedFileLocation,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkMenu?.(event, path);
  }, [onOpenFileLinkMenu]);
  const resolvedHrefFilePathCacheRef = useRef(new Map<string, ParsedFileLocation | null>());
  useEffect(() => {
    resolvedHrefFilePathCacheRef.current.clear();
  }, [workspacePath]);
  const resolveHrefFilePath = useCallback((url: string) => {
    const resolvedHrefFilePathCache = resolvedHrefFilePathCacheRef.current;
    if (resolvedHrefFilePathCache.has(url)) {
      return resolvedHrefFilePathCache.get(url) ?? null;
    }
    const resolvedPath = resolveMessageFileHref(url, workspacePath);
    if (!resolvedPath) {
      resolvedHrefFilePathCache.set(url, null);
      return null;
    }
    resolvedHrefFilePathCache.set(url, resolvedPath);
    return resolvedPath;
  }, [workspacePath]);
  const lightboxImages = useMemo(
    () => (
      lightboxImage
        ? [{ src: lightboxImage.src, label: lightboxImage.alt, sourcePath: lightboxImage.sourcePath }]
        : []
    ),
    [lightboxImage],
  );
  const openLightboxImage = useCallback((src: string, alt: string, sourcePath?: string) => {
    setLightboxImage({ src, alt, sourcePath });
    setLightboxOpen(true);
  }, []);
  useEffect(() => {
    setIsCollapsed(enableCollapse);
  }, [markdownValue, enableCollapse]);

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
      const nextIsCollapsible = isCollapsible
        ? node.scrollHeight > COLLAPSIBLE_MARKDOWN_MAX_HEIGHT - COLLAPSIBLE_MARKDOWN_HYSTERESIS_PX
        : node.scrollHeight > COLLAPSIBLE_MARKDOWN_MAX_HEIGHT + COLLAPSIBLE_MARKDOWN_HYSTERESIS_PX;
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
  }, [enableCollapse, content, isCollapsible]);
  const resolveCachedMarkdownImageSrc = useCallback((url: string) => {
    const cacheKey = `${workspacePath ?? ""}::${url.trim()}`;
    const cached = imageSrcCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      if (cached) {
        void preloadMarkdownImageSrc(cached);
      }
      return cached;
    }
    const resolvedSrc = resolveMarkdownImageSrc(url, workspacePath);
    imageSrcCacheRef.current.set(cacheKey, resolvedSrc);
    if (resolvedSrc) {
      void preloadMarkdownImageSrc(resolvedSrc);
    }
    return resolvedSrc;
  }, [workspacePath]);
  const shouldShowFileImagePreview = useCallback((path: string) => {
    if (!isImageFilePath(path)) {
      return false;
    }
    const previewKey = resolveMarkdownImagePreviewKey(path, workspacePath);
    return previewKey ? !markdownImagePreviewKeys.has(previewKey) : true;
  }, [markdownImagePreviewKeys, workspacePath]);
  const urlTransform = useCallback((url: string) => {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    if (resolveHrefFilePath(url)) {
      return url;
    }
    if (
      isFileLinkUrl(url) ||
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("mailto:") ||
      url.startsWith("#") ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../")
    ) {
      return url;
    }
    if (!hasScheme) {
      return url;
    }
    return "";
  }, [resolveHrefFilePath]);
  const components = useMemo<Components>(() => {
    const nextComponents: Components = {
      table: ({ children }) => {
        const columnCount = countTableColumns(children);
        const isStructuredTable = columnCount >= 5;
        return (
          <div className="markdown-table-wrap">
            <table
              className={`markdown-table${isStructuredTable ? " markdown-table--structured" : ""}`}
            >
              {children}
            </table>
          </div>
        );
      },
      th: ({ children }) => (
        <th>
          <span className="markdown-table-cell-inner">{children}</span>
        </th>
      ),
      td: ({ children }) => (
        <td>
          <span className="markdown-table-cell-inner">{children}</span>
        </td>
      ),
      img: ({ src, alt }) => {
        const url = (src ?? "").trim();
        if (!enableRichLinks) {
          const label = alt?.trim() || fileNameFromPath(url) || url || "image";
          return url ? <a href={url} onClick={handleLocalLinkClick}>{label}</a> : (alt ? <span>{alt}</span> : null);
        }
        const resolvedSrc = resolveCachedMarkdownImageSrc(url);
        if (!resolvedSrc) {
          return alt ? <span>{alt}</span> : null;
        }
        const imageAlt = alt ?? "image";
        const sourcePath = resolveHrefFilePath(url)?.path ?? (isAbsolutePath(url) ? url : undefined);
        const openImage = () => {
          setLightboxImage({ src: resolvedSrc, alt: imageAlt, sourcePath });
          setLightboxOpen(true);
        };
        return <InlineImagePreview src={resolvedSrc} alt={imageAlt} sourcePath={sourcePath} onOpen={openImage} />;
      },
      a: ({ href, children }) => {
        const url = (href ?? "").trim();
        const linkText = textFromReactNode(children).trim();
        if (!enableRichLinks) {
          if (!url) {
            return <>{children}</>;
          }
          const isExternalLink =
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("mailto:");
          if (isExternalLink) {
            return (
              <a href={href} onClick={(event) => openWebLink(event, url)}>
                {children}
              </a>
            );
          }
          return (
            <a href={href} onClick={handleLocalLinkClick}>
              {children}
            </a>
          );
        }
        const threadId = url.startsWith("thread://")
          ? url.slice("thread://".length).trim()
          : url.startsWith("/thread/")
            ? url.slice("/thread/".length).trim()
            : "";
        if (threadId) {
          return (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenThreadLink?.(threadId);
              }}
            >
              {children}
            </a>
          );
        }
        if (isFileLinkUrl(url)) {
          const path = parseFileLinkUrl(url);
          if (!path) {
            return (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                {children}
              </a>
            );
          }
          if (!isFolderTarget(path)) {
            const imagePreviewSrc = shouldShowFileImagePreview(path.path)
              ? resolveCachedMarkdownImageSrc(path.path)
              : "";
            const imagePreviewSourcePath = isImageFilePath(path.path)
              ? toAbsolutePreviewPath(path.path, workspacePath)
              : undefined;
            return (
              <FileReferenceLink
                href={href ?? toFileLink(path)}
                rawPath={path}
                workspacePath={workspacePath}
                imagePreviewSrc={imagePreviewSrc}
                imagePreviewSourcePath={imagePreviewSourcePath}
                onClick={handleFileLinkClick}
                onContextMenu={handleFileLinkContextMenu}
                onOpenImagePreview={openLightboxImage}
              />
            );
          }
          return (
            <FileReferenceLink
              href={href ?? toFileLink(path)}
              rawPath={path}
              workspacePath={workspacePath}
              onClick={handleFileLinkClick}
              onContextMenu={handleFileLinkContextMenu}
            />
          );
        }
        const resolvedHrefFilePath = resolveHrefFilePath(url);
        if (resolvedHrefFilePath) {
          const hrefFilePath = mergeLineFromLinkText(resolvedHrefFilePath, children);
          const formattedHrefFilePath = formatParsedFileLocation(hrefFilePath);
          const shouldUseResolvedPathLabel =
            Boolean(linkText) &&
            isPathLikeLinkLabel(linkText) &&
            (isImageFilePath(hrefFilePath.path) || !isTextFileTarget(hrefFilePath));
          if (!linkText && isImageFilePath(hrefFilePath.path)) {
            const imageSrc = resolveCachedMarkdownImageSrc(url);
            if (imageSrc) {
              const sourcePath = toAbsolutePreviewPath(hrefFilePath.path, workspacePath);
              const openImage = () => {
                setLightboxImage({ src: imageSrc, alt: "image", sourcePath });
                setLightboxOpen(true);
              };
              return <InlineImagePreview src={imageSrc} alt="image" sourcePath={sourcePath} onOpen={openImage} />;
            }
          }
          const clickHandler = (event: React.MouseEvent) =>
            handleFileLinkClick(event, hrefFilePath);
          const contextMenuHandler = onOpenFileLinkMenu
            ? (event: React.MouseEvent) => handleFileLinkContextMenu(event, hrefFilePath)
            : undefined;
          if (!isFolderTarget(hrefFilePath)) {
            const imagePreviewSrc = shouldShowFileImagePreview(hrefFilePath.path)
              ? resolveCachedMarkdownImageSrc(hrefFilePath.path)
              : "";
            const imagePreviewSourcePath = isImageFilePath(hrefFilePath.path)
              ? toAbsolutePreviewPath(hrefFilePath.path, workspacePath)
              : undefined;
            return (
              <FileReferenceLink
                href={href ?? toFileLink(hrefFilePath)}
                rawPath={hrefFilePath}
                workspacePath={workspacePath}
                imagePreviewSrc={imagePreviewSrc}
                imagePreviewSourcePath={imagePreviewSourcePath}
                onClick={handleFileLinkClick}
                onContextMenu={handleFileLinkContextMenu}
                onOpenImagePreview={openLightboxImage}
              />
            );
          }
          if (isTextFileTarget(hrefFilePath) || isFolderTarget(hrefFilePath)) {
            return (
              <FileReferenceLink
                href={href ?? toFileLink(hrefFilePath)}
                rawPath={hrefFilePath}
                workspacePath={workspacePath}
                onClick={handleFileLinkClick}
                onContextMenu={handleFileLinkContextMenu}
              />
            );
          }
          return (
            <a
              href={href ?? toFileLink(hrefFilePath)}
              title={formattedHrefFilePath}
              onClick={clickHandler}
              onContextMenu={contextMenuHandler}
            >
              {shouldUseResolvedPathLabel ? formattedHrefFilePath : children}
            </a>
          );
        }
        const isExternal =
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:");

        if (isRenderableImageUrl(url) && (!linkText || linkText === url)) {
          const imageAlt = linkText && linkText !== url ? linkText : "image";
          const sourcePath = isAbsolutePath(url) ? url : undefined;
          const openImage = () => {
            setLightboxImage({ src: url, alt: imageAlt, sourcePath });
            setLightboxOpen(true);
          };
          return <InlineImagePreview src={url} alt={imageAlt} sourcePath={sourcePath} onOpen={openImage} />;
        }

        if (!isExternal) {
          if (url.startsWith("#")) {
            return <a href={href}>{children}</a>;
          }
          return (
            <a href={href} onClick={handleLocalLinkClick}>
              {children}
            </a>
          );
        }

        return (
          <a
            href={href}
            onClick={(event) => openWebLink(event, url)}
          >
            {children}
          </a>
        );
      },
      code: ({ className: codeClassName, children }) => {
        if (codeClassName) {
          return <code className={codeClassName}>{children}</code>;
        }
        const text = String(children ?? "").trim();
        const fileTarget = parseInlineFileTarget(text);
        if (!fileTarget) {
          return <code>{children}</code>;
        }
        const href = toFileLink(fileTarget);
        return (
          <FileReferenceLink
            href={href}
            rawPath={fileTarget}
            workspacePath={workspacePath}
            imagePreviewSrc={shouldShowFileImagePreview(fileTarget.path) ? resolveCachedMarkdownImageSrc(fileTarget.path) : ""}
            imagePreviewSourcePath={isImageFilePath(fileTarget.path)
              ? toAbsolutePreviewPath(fileTarget.path, workspacePath)
              : undefined}
            onClick={handleFileLinkClick}
            onContextMenu={handleFileLinkContextMenu}
            onOpenImagePreview={openLightboxImage}
          />
        );
      },
    };

    if (codeBlockStyle === "message") {
      nextComponents.pre = ({ node, children }) => (
        <PreBlock node={node as PreProps["node"]} copyUseModifier={codeBlockCopyUseModifier}>
          {children}
        </PreBlock>
      );
    }

    return nextComponents;
  }, [
    codeBlockCopyUseModifier,
    codeBlockStyle,
    enableRichLinks,
    handleFileLinkClick,
    handleFileLinkContextMenu,
    handleLocalLinkClick,
    onOpenFileLinkMenu,
    onOpenThreadLink,
    openLightboxImage,
    openWebLink,
    resolveCachedMarkdownImageSrc,
    resolveHrefFilePath,
    shouldShowFileImagePreview,
    workspacePath,
  ]);

  return (
    <>
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
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            urlTransform={urlTransform}
            components={components}
          >
            {content}
          </ReactMarkdown>
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
      {lightboxOpen && lightboxImage ? (
        <ImageLightbox
          images={lightboxImages}
          activeIndex={0}
          onClose={() => {
            setLightboxOpen(false);
            setLightboxImage(null);
          }}
        />
      ) : null}
    </>
  );
});
