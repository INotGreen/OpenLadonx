import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent,
  DragEvent,
  JSX,
  KeyboardEvent,
  MutableRefObject,
  RefObject,
} from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { homeDir } from "@tauri-apps/api/path";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  DecoratorNode,
  TextNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import type { AutocompleteItem } from "../hooks/useComposerAutocomplete";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Hand from "lucide-react/dist/esm/icons/hand";
import ListTodo from "lucide-react/dist/esm/icons/list-todo";
import Mic from "lucide-react/dist/esm/icons/mic";
import Package from "lucide-react/dist/esm/icons/package";
import Plus from "lucide-react/dist/esm/icons/plus";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import Target from "lucide-react/dist/esm/icons/target";
import X from "lucide-react/dist/esm/icons/x";
import { Zap } from "lucide-react";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { useMenuController } from "@/features/app/hooks/useMenuController";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "@/features/design-system/components/popover/PopoverPrimitives";
import { useComposerImageDrop } from "../hooks/useComposerImageDrop";
import { ComposerAttachments } from "./ComposerAttachments";
import {
  ComposerAttachPopover,
  type ComposerActionTag,
} from "./ComposerAttachPopover";
import { ComposerSuggestionsPopover } from "./ComposerSuggestionsPopover";
import { useComposerInputLayout } from "../hooks/useComposerInputLayout";
import type { ReviewPromptState, ReviewPromptStep } from "../../threads/hooks/useReviewPrompt";
import type { AccessMode, PluginOption, ServiceTier, ThreadTokenUsage } from "../../../types";
import { pickAttachmentFiles } from "../../../services/tauri";
import { pickAttachmentFolders } from "../../../services/tauri";
import { pickAttachmentImages } from "../../../services/tauri";
import { isImageAttachmentPath } from "../../threads/hooks/threadMessagingHelpers";
import {
  REASONING_EFFORT_OPTIONS,
  formatReasoningEffortLabel,
} from "@/utils/reasoningEffort";
import { getFileTypeIconUrl, getFolderTypeIconUrl } from "@/utils/fileTypeIcons";
import { getCurrentWorkspacePath } from "../../../services/tauri";
import { isAbsolutePath, joinWorkspacePath } from "../../../utils/platformPaths";
import { resolveMountedWorkspacePath } from "../../messages/utils/mountedWorkspacePaths";

const COMPOSER_TOKEN_PATTERN =
  /\[\$(plugin|[^\]:\s]+):([^\]\s]+)\]\(([^)]+)\)|@'((?:\\.|[^'\\\n])*)'/g;
const BARE_ATTACH_TRIGGER_REGEX = /(?:^|[\s"'`([{])@$/;

type SerializedComposerSkillNode = SerializedLexicalNode & {
  name: string;
  path: string;
};

type SerializedComposerPluginNode = SerializedLexicalNode & {
  name: string;
  path: string;
};

type SerializedComposerFilePathNode = SerializedLexicalNode & {
  path: string;
};

const EXTENSIONLESS_FILE_NAMES = new Set([
  "dockerfile",
  "gemfile",
  "license",
  "makefile",
  "procfile",
  "readme",
  "rakefile",
]);

const composerPluginMetaByPath = new Map<
  string,
  { displayName?: string; iconDataUrl?: string; brandColor?: string }
>();

function getFilePathLabel(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments[segments.length - 1] || path;
}

function buildPluginInsertText(plugin: PluginOption) {
  const pluginName = plugin.name.trim().replace(/\s+/g, "");
  const pluginPath = plugin.path.trim();
  return `[$plugin:${pluginName}](${pluginPath})`;
}

function encodeComposerFilePathToken(path: string) {
  return path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function decodeComposerFilePathToken(path: string) {
  return path.replace(/\\(['\\])/g, "$1");
}

function buildFilePathInsertText(path: string) {
  return `@'${encodeComposerFilePathToken(path)}'`;
}

function findBareAttachTriggerStart(text: string, cursor: number | null) {
  if (!text || cursor === null) {
    return null;
  }
  const beforeCursor = text.slice(0, cursor);
  if (!BARE_ATTACH_TRIGGER_REGEX.test(beforeCursor)) {
    return null;
  }
  const atIndex = beforeCursor.lastIndexOf("@");
  return atIndex >= 0 ? atIndex : null;
}

function normalizePathSeparators(path: string) {
  return path.replace(/\\/g, "/");
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

async function resolveComposerNodePath(path: string, workspacePath?: string | null) {
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

async function openComposerNodeDirectory(
  path: string,
  options: { treatAsFolder: boolean; workspacePath?: string | null },
) {
  const resolvedPath = await resolveComposerNodePath(path, options.workspacePath);
  const targetPath = options.treatAsFolder ? resolvedPath : dirname(resolvedPath) || resolvedPath;
  try {
    if (options.treatAsFolder) {
      await openPath(targetPath);
      return;
    }
    await revealItemInDir(resolvedPath);
  } catch (error) {
    console.error("Failed to open composer node directory", {
      path,
      resolvedPath,
      targetPath,
      error,
    });
  }
}

class ComposerSkillNode extends DecoratorNode<JSX.Element> {
  __name: string;
  __path: string;

  static getType(): string {
    return "composer-skill";
  }

  static clone(node: ComposerSkillNode): ComposerSkillNode {
    return new ComposerSkillNode(node.__name, node.__path, node.__key);
  }

  constructor(name: string, path: string, key?: NodeKey) {
    super(key);
    this.__name = name;
    this.__path = path;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-skill-node-shell";
    return dom;
  }

  updateDOM(): false {
    return false;
  }

  static importJSON(serializedNode: SerializedComposerSkillNode): ComposerSkillNode {
    return $createComposerSkillNode(serializedNode.name, serializedNode.path).updateFromJSON(serializedNode);
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedComposerSkillNode>): this {
    super.updateFromJSON(serializedNode);
    this.__name = serializedNode.name;
    this.__path = serializedNode.path;
    return this;
  }

  exportJSON(): SerializedComposerSkillNode {
    return {
      ...super.exportJSON(),
      name: this.__name,
      path: this.__path,
    };
  }

  getTextContent(): string {
    return `[$${this.__name}:${this.__name}](${this.__path})`;
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): false {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <span
        className="composer-skill-node"
        title={this.__path}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={() => {
          void openComposerNodeDirectory(this.__path, {
            treatAsFolder: false,
            workspacePath: composerNodeWorkspacePath,
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
          <span>{this.__name}</span>
        </span>
      </span>
    );
  }
}

function $createComposerSkillNode(name: string, path: string) {
  return $applyNodeReplacement(new ComposerSkillNode(name, path));
}

class ComposerPluginNode extends DecoratorNode<JSX.Element> {
  __name: string;
  __path: string;

  static getType(): string {
    return "composer-plugin";
  }

  static clone(node: ComposerPluginNode): ComposerPluginNode {
    return new ComposerPluginNode(node.__name, node.__path, node.__key);
  }

  constructor(name: string, path: string, key?: NodeKey) {
    super(key);
    this.__name = name;
    this.__path = path;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-skill-node-shell";
    return dom;
  }

  updateDOM(): false {
    return false;
  }

  static importJSON(serializedNode: SerializedComposerPluginNode): ComposerPluginNode {
    return $createComposerPluginNode(serializedNode.name, serializedNode.path).updateFromJSON(
      serializedNode,
    );
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedComposerPluginNode>): this {
    super.updateFromJSON(serializedNode);
    this.__name = serializedNode.name;
    this.__path = serializedNode.path;
    return this;
  }

  exportJSON(): SerializedComposerPluginNode {
    return {
      ...super.exportJSON(),
      name: this.__name,
      path: this.__path,
    };
  }

  getTextContent(): string {
    return `[$plugin:${this.__name}](${this.__path})`;
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): false {
    return false;
  }

  decorate(): JSX.Element {
    const pluginMeta = composerPluginMetaByPath.get(this.__path);
    const displayName = pluginMeta?.displayName?.trim() || this.__name;
    const iconDataUrl = pluginMeta?.iconDataUrl?.trim() ?? "";
    const brandColor = pluginMeta?.brandColor?.trim() ?? "";
    return (
      <span
        className="composer-plugin-node"
        title={this.__path}
        style={brandColor ? { color: brandColor } : undefined}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={() => {
          void openComposerNodeDirectory(this.__path, {
            treatAsFolder: false,
            workspacePath: composerNodeWorkspacePath,
          });
        }}
      >
        <span className="composer-plugin-node-prefix">
          {iconDataUrl ? (
            <img
              className="composer-plugin-node-icon"
              src={iconDataUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <Package
              className="composer-plugin-node-icon"
              size={14}
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          <span>{displayName}</span>
        </span>
      </span>
    );
  }
}

function $createComposerPluginNode(name: string, path: string) {
  return $applyNodeReplacement(new ComposerPluginNode(name, path));
}

class ComposerFilePathNode extends DecoratorNode<JSX.Element> {
  __path: string;

  static getType(): string {
    return "composer-file-path";
  }

  static clone(node: ComposerFilePathNode): ComposerFilePathNode {
    return new ComposerFilePathNode(node.__path, node.__key);
  }

  constructor(path: string, key?: NodeKey) {
    super(key);
    this.__path = path;
  }

  createDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-skill-node-shell";
    return dom;
  }

  updateDOM(): false {
    return false;
  }

  static importJSON(serializedNode: SerializedComposerFilePathNode): ComposerFilePathNode {
    return $createComposerFilePathNode(serializedNode.path).updateFromJSON(serializedNode);
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedComposerFilePathNode>): this {
    super.updateFromJSON(serializedNode);
    this.__path = serializedNode.path;
    return this;
  }

  exportJSON(): SerializedComposerFilePathNode {
    return {
      ...super.exportJSON(),
      path: this.__path,
    };
  }

  getTextContent(): string {
    return buildFilePathInsertText(this.__path);
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): false {
    return false;
  }

  decorate(): JSX.Element {
    const label = getFilePathLabel(this.__path);
    const isFolder = isLikelyFolderPath(this.__path, label);
    const iconUrl = isFolder
      ? getFolderTypeIconUrl(this.__path)
      : getFileTypeIconUrl(this.__path);
    return (
      <span
        className="composer-file-path-node"
        title={this.__path}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={() => {
          void openComposerNodeDirectory(this.__path, {
            treatAsFolder: isFolder,
            workspacePath: composerNodeWorkspacePath,
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
          <span className="composer-file-path-node-label">{label}</span>
        </span>
      </span>
    );
  }
}

function $createComposerFilePathNode(path: string) {
  return $applyNodeReplacement(new ComposerFilePathNode(path));
}

function parseComposerTextToNodes(text: string): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  let cursor = 0;
  COMPOSER_TOKEN_PATTERN.lastIndex = 0;
  for (
    let match = COMPOSER_TOKEN_PATTERN.exec(text);
    match;
    match = COMPOSER_TOKEN_PATTERN.exec(text)
  ) {
    if (match.index > cursor) {
      appendPlainTextNodes(nodes, text.slice(cursor, match.index));
    }
    if (match[1] && match[3]) {
      if (match[1] === "plugin") {
        nodes.push($createComposerPluginNode(match[2], match[3]));
      } else {
        nodes.push($createComposerSkillNode(match[2], match[3]));
      }
    } else if (match[4]) {
      nodes.push($createComposerFilePathNode(decodeComposerFilePathToken(match[4])));
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    appendPlainTextNodes(nodes, text.slice(cursor));
  }
  return nodes;
}

function appendPlainTextNodes(nodes: LexicalNode[], value: string) {
  const parts = value.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) {
      nodes.push($createLineBreakNode());
    }
    if (part) {
      nodes.push($createTextNode(part));
    }
  });
}

function $setComposerEditorText(text: string) {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  paragraph.append(...parseComposerTextToNodes(text));
  root.append(paragraph);
}

function $transformSkillTokens(node: TextNode) {
  const textContent = node.getTextContent();
  COMPOSER_TOKEN_PATTERN.lastIndex = 0;
  const match = COMPOSER_TOKEN_PATTERN.exec(textContent);
  if (!match) {
    return;
  }
  const start = match.index;
  const end = start + match[0].length;
  let tokenNode: TextNode;
  let trailingNode: TextNode | null = null;
  if (start === 0) {
    if (end === textContent.length) {
      tokenNode = node;
    } else {
      [tokenNode, trailingNode] = node.splitText(end);
    }
  } else if (end === textContent.length) {
    [, tokenNode] = node.splitText(start);
  } else {
    [, tokenNode, trailingNode] = node.splitText(start, end);
  }
  if (match[1] && match[3]) {
    tokenNode.replace(
      match[1] === "plugin"
        ? $createComposerPluginNode(match[2], match[3])
        : $createComposerSkillNode(match[2], match[3]),
    );
  } else if (match[4]) {
    tokenNode.replace($createComposerFilePathNode(decodeComposerFilePathToken(match[4])));
  }
  if (trailingNode) {
    COMPOSER_TOKEN_PATTERN.lastIndex = 0;
    if (COMPOSER_TOKEN_PATTERN.test(trailingNode.getTextContent())) {
      $transformSkillTokens(trailingNode);
    }
  }
}

function $getSelectionStartFromEditor() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }
  return $getPlainOffsetForPoint(
    selection.isBackward() ? selection.focus.key : selection.anchor.key,
    selection.isBackward() ? selection.focus.offset : selection.anchor.offset,
    selection.isBackward() ? selection.focus.type : selection.anchor.type,
  );
}

function $getSelectionRangeFromEditor() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }
  const anchorOffset = $getPlainOffsetForPoint(
    selection.anchor.key,
    selection.anchor.offset,
    selection.anchor.type,
  );
  const focusOffset = $getPlainOffsetForPoint(
    selection.focus.key,
    selection.focus.offset,
    selection.focus.type,
  );
  return {
    anchorOffset,
    focusOffset,
    isCollapsed: selection.isCollapsed(),
    start: Math.min(anchorOffset, focusOffset),
    end: Math.max(anchorOffset, focusOffset),
  };
}

function $getPlainOffsetForPoint(
  pointKey: NodeKey,
  pointOffset: number,
  pointType: "text" | "element",
) {
  const root = $getRoot();
  const paragraph = root.getFirstChild();
  if (!$isElementNode(paragraph)) {
    return 0;
  }
  let offset = 0;
  for (const child of paragraph.getChildren()) {
    if (pointType === "text" && child.getKey() === pointKey) {
      return offset + pointOffset;
    }
    if (pointType === "element" && paragraph.getKey() === pointKey) {
      const childIndex = child.getIndexWithinParent();
      if (childIndex >= pointOffset) {
        return offset;
      }
    }
    offset += child.getTextContentSize();
  }
  return offset;
}

function $setSelectionFromPlainOffset(offset: number) {
  const root = $getRoot();
  const paragraph = root.getFirstChild();
  if (!$isElementNode(paragraph)) {
    return;
  }
  const targetOffset = Math.max(0, offset);
  let currentOffset = 0;
  for (const child of paragraph.getChildren()) {
    const size = child.getTextContentSize();
    if (targetOffset <= currentOffset + size) {
      if ($isTextNode(child)) {
        const childOffset = Math.max(0, Math.min(size, targetOffset - currentOffset));
        child.select(childOffset, childOffset);
        return;
      }
      const childIndex = child.getIndexWithinParent();
      const elementOffset = targetOffset <= currentOffset ? childIndex : childIndex + 1;
      paragraph.select(elementOffset, elementOffset);
      return;
    }
    currentOffset += size;
  }
  const lastChild = paragraph.getLastChild();
  if ($isTextNode(lastChild)) {
    const size = lastChild.getTextContentSize();
    lastChild.select(size, size);
    return;
  }
  paragraph.selectEnd();
}

function syncTextareaBridge(
  textarea: HTMLTextAreaElement | null,
  value: string,
  selectionStart: number | null,
) {
  if (!textarea) {
    return;
  }
  if (textarea.value !== value) {
    textarea.value = value;
  }
  const cursor = Math.min(Math.max(selectionStart ?? value.length, 0), value.length);
  textarea.setSelectionRange(cursor, cursor);
}

/**
 * Composer 输入组件属性
 */
type ComposerInputProps = {
  workspacePath?: string | null;
  plugins?: PluginOption[];
  /** 文本内容 */
  text: string;
  /** 是否禁用 */
  disabled: boolean;
  /** 发送按钮标签 */
  sendLabel: string;
  /** 是否可以停止生成 */
  canStop: boolean;
  /** 是否可以发送 */
  canSend: boolean;
  /** 是否正在处理 */
  isProcessing: boolean;
  /** 停止生成回调 */
  onStop: () => void;
  /** 发送回调 */
  onSend: () => void;
  /** 听写状态 */
  dictationState?: "idle" | "listening" | "processing";
  /** 听写音量级别 */
  dictationLevel?: number;
  /** 是否启用听写功能 */
  dictationEnabled?: boolean;
  /** 切换听写回调 */
  onToggleDictation?: () => void;
  /** 取消听写回调 */
  onCancelDictation?: () => void;
  /** 打开听写设置回调 */
  onOpenDictationSettings?: () => void;
  /** 切换线程终端回调 */
  onToggleTerminal?: (modelOverride?: string | null) => void;
  /** 线程终端是否展开 */
  terminalOpen?: boolean;
  /** 听写错误信息 */
  dictationError?: string | null;
  /** 忽略听写错误回调 */
  onDismissDictationError?: () => void;
  /** 听写提示信息 */
  dictationHint?: string | null;
  /** 忽略听写提示回调 */
  onDismissDictationHint?: () => void;
  /** 当前附件列表 */
  attachments?: string[];
  /** 拖放目标引用 */
  dropTargetRef?: RefObject<HTMLDivElement | null>;
  /** 是否正在外部拖放 */
  isDragOverExternal?: boolean;
  /** 拖放区域拖悬回调 */
  onDropAreaDragOver?: (event: DragEvent<HTMLElement>) => void;
  /** 拖放区域进入回调 */
  onDropAreaDragEnter?: (event: DragEvent<HTMLElement>) => void;
  /** 拖放区域离开回调 */
  onDropAreaDragLeave?: () => void;
  /** 拖放区域放置回调 */
  onDropAreaDrop?: (event: DragEvent<HTMLElement>) => void | Promise<void>;
  /** 预览附件回调 */
  onPreviewAttachment?: (path: string, kind?: "file" | "folder") => void;
  /** 打开附件选择器回调 */
  onAddAttachment?: () => void | Promise<void>;
  /** 添加图片附件回调 */
  onAttachImages?: (paths: string[]) => void;
  /** 移除附件回调 */
  onRemoveAttachment?: (path: string) => void;
  /** 文本变更回调 */
  onTextChange: (next: string, selectionStart: number | null) => void;
  /** 文本粘贴回调 */
  onTextPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** 选择变更回调 */
  onSelectionChange: (selectionStart: number | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  isExpanded?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  selectionStart?: number | null;
  suggestionsOpen: boolean;
  suggestions: AutocompleteItem[];
  highlightIndex: number;
  onHighlightIndex: (index: number) => void;
  onSelectSuggestion: (item: AutocompleteItem) => void;
  suggestionsStyle?: React.CSSProperties;
  reviewPrompt?: ReviewPromptState;
  onReviewPromptClose?: () => void;
  onReviewPromptShowPreset?: () => void;
  onReviewPromptChoosePreset?: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  highlightedPresetIndex?: number;
  onReviewPromptHighlightPreset?: (index: number) => void;
  highlightedBranchIndex?: number;
  onReviewPromptHighlightBranch?: (index: number) => void;
  highlightedCommitIndex?: number;
  onReviewPromptHighlightCommit?: (index: number) => void;
  onReviewPromptSelectBranch?: (value: string) => void;
  onReviewPromptSelectBranchAtIndex?: (index: number) => void;
  onReviewPromptConfirmBranch?: () => Promise<void>;
  onReviewPromptSelectCommit?: (sha: string, title: string) => void;
  onReviewPromptSelectCommitAtIndex?: (index: number) => void;
  onReviewPromptConfirmCommit?: () => Promise<void>;
  onReviewPromptUpdateCustomInstructions?: (value: string) => void;
  onReviewPromptConfirmCustom?: () => Promise<void>;
  collaborationModes: ComposerCollaborationModeOption[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  models: ComposerModelOption[];
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  selectedServiceTier: ServiceTier | null;
  reasoningSupported: boolean;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  contextUsage?: ThreadTokenUsage | null;
};

type ComposerModelOption = {
  id: string;
  displayName: string;
  model: string;
  provider?: string | null;
};

type ComposerCollaborationModeOption = {
  id: string;
  label: string;
  mode?: string | null;
  value?: Record<string, unknown> | null;
};

let composerNodeWorkspacePath: string | null = null;

type ModelProviderId =
  | "gpt"
  | "deepseek"
  | "claude"
  | "qwen"
  | "zhipu"
  | "minimax"
  | "gemini"
  | "grok"
  | "kimi"
  | "other";

const MODEL_PROVIDER_ORDER: Array<{ id: ModelProviderId; labelKey: string }> = [
  { id: "gpt", labelKey: "composer.modelProviders.gpt" },
  { id: "deepseek", labelKey: "composer.modelProviders.deepseek" },
  { id: "claude", labelKey: "composer.modelProviders.claude" },
  { id: "qwen", labelKey: "composer.modelProviders.qwen" },
  { id: "zhipu", labelKey: "composer.modelProviders.zhipu" },
  { id: "minimax", labelKey: "composer.modelProviders.minimax" },
  { id: "gemini", labelKey: "composer.modelProviders.gemini" },
  { id: "grok", labelKey: "composer.modelProviders.grok" },
  { id: "kimi", labelKey: "composer.modelProviders.kimi" },
  { id: "other", labelKey: "composer.modelProviders.other" },
];

const COMPOSER_ACTION_TAG_LABELS: Record<ComposerActionTag, string> = {
  plan: "计划",
  goal: "目标",
};

const COMPOSER_CONTEXT_WINDOW_TOKENS = 1_000_000;

function getComposerActionTagForMode(
  mode: ComposerCollaborationModeOption | null | undefined,
): ComposerActionTag | null {
  if (!mode) {
    return null;
  }
  const rawValue = mode.value;
  const rawCandidates = [
    mode.mode,
    mode.id,
    mode.label,
    rawValue?.mode,
    rawValue?.id,
    rawValue?.name,
    rawValue?.label,
  ];
  const candidates = rawCandidates
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (candidates.some((value) => value === "plan" || value === "计划")) return "plan";
  if (candidates.some((value) => value === "goal" || value === "目标")) return "goal";
  return null;
}

function getComposerModeSelectionValues(mode: ComposerCollaborationModeOption) {
  const rawValue = mode.value;
  const rawCandidates = [
    mode.id,
    mode.mode,
    rawValue?.id,
    rawValue?.mode,
    rawValue?.name,
  ];
  return rawCandidates
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function formatComposerTokenCount(value: number) {
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}万`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  }
  return String(value);
}

function buildContextUsageMeter(contextUsage: ThreadTokenUsage | null | undefined) {
  const usedTokens = Math.max(0, Math.round(contextUsage?.last.inputTokens ?? 0));
  const contextWindow = COMPOSER_CONTEXT_WINDOW_TOKENS;
  if (usedTokens <= 0) {
    return null;
  }
  const usedPercent = Math.min(
    100,
    Math.max(0, Math.round((usedTokens / contextWindow) * 100)),
  );
  const label =
    `Current context: ${formatComposerTokenCount(usedTokens)} / ` +
    `${formatComposerTokenCount(contextWindow)} (${usedPercent}%)`;
  const totalInputTokens = Math.max(0, Math.round(contextUsage?.total.inputTokens ?? 0));
  const totalCachedTokens = Math.max(0, Math.round(contextUsage?.total.cachedInputTokens ?? 0));
  const cacheHitPercent =
    totalInputTokens > 0
      ? Math.min(100, Math.max(0, (totalCachedTokens / totalInputTokens) * 100))
      : 0;
  return {
    cacheHitLabel: `${cacheHitPercent.toFixed(1)}%`,
    capacityLabel:
      `${formatComposerTokenCount(usedTokens)}/${formatComposerTokenCount(contextWindow)} ` +
      `(${usedPercent}%)`,
    label,
    usedPercent,
  };
}

function findSelectedComposerMode(
  modes: ComposerCollaborationModeOption[],
  selectedModeId: string | null,
) {
  const normalizedSelectedModeId = selectedModeId?.trim();
  if (!normalizedSelectedModeId) {
    return null;
  }
  return (
    modes.find((mode) =>
      getComposerModeSelectionValues(mode).includes(normalizedSelectedModeId),
    ) ?? null
  );
}

type ComposerLexicalEditorProps = {
  disabled: boolean;
  onBridgeSelectionChange: (selectionStart: number | null) => void;
  onDragEnter?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: () => void;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDrop?: (event: DragEvent<HTMLElement>) => void | Promise<void>;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextChange: (next: string, selectionStart: number | null) => void;
  onTextPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

function ComposerLexicalEditor({
  disabled,
  onBridgeSelectionChange,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onKeyDown,
  onTextChange,
  onTextPaste,
  placeholder,
  text,
  textareaRef,
}: ComposerLexicalEditorProps) {
  const bridgeRef = textareaRef as MutableRefObject<HTMLTextAreaElement | null>;
  const [editor] = useLexicalComposerContext();
  const isSyncingFromPropsRef = useRef(false);
  const isSyncingBridgeRef = useRef(false);
  const lastTextRef = useRef(text);

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, $transformSkillTokens);
  }, [editor]);

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    const textarea = bridgeRef.current;
    if (!textarea) {
      return;
    }
    const nativeFocus = textarea.focus.bind(textarea);
    const nativeBlur = textarea.blur.bind(textarea);
    const nativeSetSelectionRange = textarea.setSelectionRange.bind(textarea);
    textarea.focus = (options?: FocusOptions) => {
      nativeFocus(options);
      editor.focus();
    };
    textarea.blur = () => {
      editor.blur();
      nativeBlur();
    };
    textarea.setSelectionRange = (
      selectionStart: number,
      selectionEnd: number,
      selectionDirection?: "forward" | "backward" | "none",
    ) => {
      nativeSetSelectionRange(selectionStart, selectionEnd, selectionDirection);
      if (isSyncingBridgeRef.current) {
        return;
      }
      const nextSelectionStart = Math.min(
        Math.max(selectionStart, 0),
        textarea.value.length,
      );
      editor.update(() => {
        $setSelectionFromPlainOffset(nextSelectionStart);
      });
      onBridgeSelectionChange(nextSelectionStart);
    };
    return () => {
      textarea.focus = nativeFocus;
      textarea.blur = nativeBlur;
      textarea.setSelectionRange = nativeSetSelectionRange;
    };
  }, [bridgeRef, editor, onBridgeSelectionChange]);

  const syncBridge = useCallback(
    (value: string, selectionStart: number | null) => {
      isSyncingBridgeRef.current = true;
      syncTextareaBridge(bridgeRef.current, value, selectionStart);
      isSyncingBridgeRef.current = false;
    },
    [bridgeRef],
  );

  useEffect(() => {
    if (lastTextRef.current === text) {
      syncBridge(text, bridgeRef.current?.selectionStart ?? text.length);
      return;
    }
    lastTextRef.current = text;
    isSyncingFromPropsRef.current = true;
    editor.update(
      () => {
        $setComposerEditorText(text);
        $setSelectionFromPlainOffset(text.length);
      },
      { tag: "composer-external-sync" },
    );
    syncBridge(text, text.length);
  }, [bridgeRef, editor, syncBridge, text]);

  const syncSelection = useCallback(() => {
    editor.getEditorState().read(() => {
      const selectionStart = $getSelectionStartFromEditor();
      syncBridge(lastTextRef.current, selectionStart);
      onBridgeSelectionChange(selectionStart);
    });
  }, [editor, onBridgeSelectionChange, syncBridge]);

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const nextText = $getRoot().getTextContent();
        const selectionStart = $getSelectionStartFromEditor();
        lastTextRef.current = nextText;
        syncBridge(nextText, selectionStart);
        if (isSyncingFromPropsRef.current) {
          isSyncingFromPropsRef.current = false;
          return;
        }
        onTextChange(nextText, selectionStart);
      });
    },
    [onTextChange, syncBridge],
  );

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown(event as unknown as KeyboardEvent<HTMLTextAreaElement>);
    },
    [onKeyDown],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      const shouldClampHorizontalCaret =
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight");

      if (shouldClampHorizontalCaret) {
        editor.getEditorState().read(() => {
          const selectionRange = $getSelectionRangeFromEditor();
          if (!selectionRange?.isCollapsed) {
            return;
          }
          const textLength = $getRoot().getTextContent().length;
          if (event.key === "ArrowLeft" && selectionRange.start <= 0) {
            event.preventDefault();
          }
          if (event.key === "ArrowRight" && selectionRange.end >= textLength) {
            event.preventDefault();
          }
        });
      }
    },
    [editor],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      onTextPaste?.(event as unknown as ClipboardEvent<HTMLTextAreaElement>);
    },
    [onTextPaste],
  );

  const handleBridgeFocus = useCallback(() => {
    editor.focus();
  }, [editor]);

  const handleBridgeSelect = useCallback(() => {
    const textarea = bridgeRef.current;
    if (!textarea) {
      return;
    }
    const nextSelectionStart = Math.min(
      Math.max(textarea.selectionStart, 0),
      textarea.value.length,
    );
    editor.update(() => {
      $setSelectionFromPlainOffset(nextSelectionStart);
    });
    onBridgeSelectionChange(nextSelectionStart);
  }, [bridgeRef, editor, onBridgeSelectionChange]);

  return (
    <div className="composer-lexical-wrap">
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            aria-label={placeholder}
            className="composer-lexical-editor"
            spellCheck
            onBlur={syncSelection}
            onClick={syncSelection}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onKeyDownCapture={handleKeyDownCapture}
            onKeyDown={handleKeyDown}
            onKeyUp={syncSelection}
            onPasteCapture={handlePaste}
            onPaste={handlePaste}
            onPointerUp={syncSelection}
          />
        }
        placeholder={<div className="composer-lexical-placeholder">{placeholder}</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin
        ignoreHistoryMergeTagChange
        ignoreSelectionChange={false}
        onChange={handleChange}
      />
      <textarea
        ref={bridgeRef}
        className="composer-textarea-bridge"
        tabIndex={-1}
        aria-hidden="true"
        value={text}
        onChange={() => undefined}
        onFocus={handleBridgeFocus}
        onSelect={handleBridgeSelect}
        readOnly
      />
    </div>
  );
}

function getModelProviderId(model: ComposerModelOption & { provider?: string | null }): ModelProviderId {
  const normalized = model.provider?.trim().toLowerCase();
  if (
    normalized === "gpt" ||
    normalized === "deepseek" ||
    normalized === "claude" ||
    normalized === "qwen" ||
    normalized === "zhipu" ||
    normalized === "minimax" ||
    normalized === "gemini" ||
    normalized === "grok" ||
    normalized === "kimi" ||
    normalized === "other"
  ) {
    return normalized;
  }
  return "other";
}

/**
 * Composer 输入组件
 * 主编辑器输入组件，提供文本编辑、附件管理、模型选择、协作模式等功能
 */
export function ComposerInput({
  workspacePath = null,
  plugins = [],
  text,
  disabled,
  sendLabel,
  canStop,
  canSend,
  isProcessing,
  onStop,
  onSend,
  dictationState = "idle",
  dictationEnabled = false,
  onToggleDictation,
  onOpenDictationSettings,
  onToggleTerminal,
  attachments = [],
  dropTargetRef: dropTargetRefProp,
  isDragOverExternal = false,
  onDropAreaDragOver,
  onDropAreaDragEnter,
  onDropAreaDragLeave,
  onDropAreaDrop: _onDropAreaDrop,
  onPreviewAttachment,
  onAddAttachment: _onAddAttachment,
  onAttachImages,
  onRemoveAttachment,
  onTextChange,
  onTextPaste,
  onSelectionChange,
  onKeyDown,
  isExpanded = false,
  textareaRef,
  selectionStart = null,
  suggestionsOpen,
  suggestions,
  highlightIndex,
  onHighlightIndex,
  onSelectSuggestion,
  suggestionsStyle,
  reviewPrompt,
  onReviewPromptClose,
  onReviewPromptShowPreset,
  onReviewPromptChoosePreset,
  highlightedPresetIndex,
  onReviewPromptHighlightPreset,
  highlightedBranchIndex,
  onReviewPromptHighlightBranch,
  highlightedCommitIndex,
  onReviewPromptHighlightCommit,
  onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom,
  models,
  selectedModelId,
  onSelectModel,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  accessMode,
  onSelectAccessMode,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  contextUsage = null,
}: ComposerInputProps) {
  composerNodeWorkspacePath = workspacePath;
  composerPluginMetaByPath.clear();
  for (const plugin of plugins) {
    const path = plugin.path.trim();
    if (!path) {
      continue;
    }
    composerPluginMetaByPath.set(path, {
      displayName: plugin.name,
      iconDataUrl: plugin.iconDataUrl,
      brandColor: plugin.brandColor,
    });
  }
  const { t } = useI18nSafe();
  const suggestionListRef = useRef<HTMLDivElement | null>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const bareAttachTriggerStart = useMemo(
    () => findBareAttachTriggerStart(text, selectionStart),
    [selectionStart, text],
  );
  const bareAttachTriggerActive = bareAttachTriggerStart !== null;
  const { isPhoneLayout, isPhoneTallInput } = useComposerInputLayout({
    isExpanded,
    text,
    textareaRef,
  });
  const insertFileReferences = useCallback(
    (paths: string[]) => {
      const normalized = Array.from(
        new Set(paths.map((path) => path.trim()).filter(Boolean)),
      );
      if (normalized.length === 0) {
        return;
      }
      const textarea = textareaRef.current;
      const selectionBegin = textarea?.selectionStart ?? text.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionBegin;
      const replaceStart =
        selectionBegin === selectionEnd
          ? findBareAttachTriggerStart(text, selectionBegin) ?? selectionBegin
          : selectionBegin;
      const before = text.slice(0, replaceStart);
      const after = text.slice(selectionEnd);
      const insert = normalized.map(buildFilePathInsertText).join(" ");
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
      const nextText = `${before}${needsLeadingSpace ? " " : ""}${insert}${needsTrailingSpace ? " " : ""}${after}`;
      const nextCursor = before.length + (needsLeadingSpace ? 1 : 0) + insert.length;
      onTextChange(nextText, nextCursor);
      requestAnimationFrame(() => {
        const current = textareaRef.current;
        if (!current) {
          return;
        }
        current.focus();
        current.setSelectionRange(nextCursor, nextCursor);
        onSelectionChange(nextCursor);
      });
    },
    [onSelectionChange, onTextChange, text, textareaRef],
  );
  const insertPluginReference = useCallback(
    (plugin: PluginOption) => {
      const insert = buildPluginInsertText(plugin);
      if (!insert || !plugin.path.trim()) {
        return;
      }
      const textarea = textareaRef.current;
      const selectionBegin = textarea?.selectionStart ?? text.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionBegin;
      const replaceStart =
        selectionBegin === selectionEnd
          ? findBareAttachTriggerStart(text, selectionBegin) ?? selectionBegin
          : selectionBegin;
      const before = text.slice(0, replaceStart);
      const after = text.slice(selectionEnd);
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
      const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
      const nextText = `${before}${needsLeadingSpace ? " " : ""}${insert}${needsTrailingSpace ? " " : ""}${after}`;
      const nextCursor = before.length + (needsLeadingSpace ? 1 : 0) + insert.length;
      onTextChange(nextText, nextCursor);
      requestAnimationFrame(() => {
        const current = textareaRef.current;
        if (!current) {
          return;
        }
        current.focus();
        current.setSelectionRange(nextCursor, nextCursor);
        onSelectionChange(nextCursor);
      });
    },
    [onSelectionChange, onTextChange, text, textareaRef],
  );
  const clearBareAttachTrigger = useCallback(() => {
    const triggerStart = findBareAttachTriggerStart(text, selectionStart);
    if (triggerStart === null) {
      return false;
    }
    const nextText = `${text.slice(0, triggerStart)}${text.slice(triggerStart + 1)}`;
    onTextChange(nextText, triggerStart);
    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) {
        return;
      }
      current.focus();
      current.setSelectionRange(triggerStart, triggerStart);
      onSelectionChange(triggerStart);
    });
    return true;
  }, [onSelectionChange, onTextChange, selectionStart, text, textareaRef]);
  const {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  } = useComposerImageDrop({
    disabled,
    onAttachFiles: (paths) => {
      const imagePaths = paths.filter((path) => isImageAttachmentPath(path.trim()));
      const filePaths = paths.filter((path) => !isImageAttachmentPath(path.trim()));
      if (imagePaths.length > 0) {
        onAttachImages?.(imagePaths);
      }
      if (filePaths.length > 0) {
        insertFileReferences(filePaths);
      }
    },
    onAttachImages,
  });
  const resolvedDropTargetRef = dropTargetRefProp ?? dropTargetRef;
  const resolvedIsDragOver = isDragOver || isDragOverExternal;
  const resolvedHandleDragOver = onDropAreaDragOver ?? handleDragOver;
  const resolvedHandleDragEnter = onDropAreaDragEnter ?? handleDragEnter;
  const resolvedHandleDragLeave = onDropAreaDragLeave ?? handleDragLeave;
  const resolvedHandleDrop = handleDrop;
  const isEmptyComposer = text.trim().length === 0;
  const showDictationButton = isPhoneLayout && isEmptyComposer && !canStop;
  const canUseDictationButton =
    Boolean(onOpenDictationSettings) ||
    (dictationEnabled && Boolean(onToggleDictation));
  const isDictationActive = dictationState === "listening";
  const isDictationProcessing = dictationState === "processing";
  const activeActionTag = useMemo<ComposerActionTag | null>(() => {
    const mode = findSelectedComposerMode(collaborationModes, selectedCollaborationModeId);
    if (!mode) {
      return null;
    }
    return getComposerActionTagForMode(mode);
  }, [collaborationModes, selectedCollaborationModeId]);

  const handleActionClick = useCallback(() => {
    if (showDictationButton) {
      if (disabled) {
        return;
      }
      if (dictationEnabled && onToggleDictation) {
        onToggleDictation();
      } else if (onOpenDictationSettings) {
        onOpenDictationSettings();
      }
      return;
    }
    if (canStop) {
      onStop();
      return;
    }
    onSend();
  }, [
    canStop,
    disabled,
    dictationEnabled,
    onOpenDictationSettings,
    onSend,
    onStop,
    onToggleDictation,
    showDictationButton,
  ]);

  const attachMenu = useMenuController();
  const prevBareAttachTriggerActiveRef = useRef(false);
  useEffect(() => {
    if (disabled) {
      attachMenu.close();
      prevBareAttachTriggerActiveRef.current = false;
      return;
    }
    if (bareAttachTriggerActive) {
      attachMenu.open();
      prevBareAttachTriggerActiveRef.current = true;
      return;
    }
    if (prevBareAttachTriggerActiveRef.current) {
      attachMenu.close();
      prevBareAttachTriggerActiveRef.current = false;
    }
  }, [attachMenu, bareAttachTriggerActive, disabled]);
  const handleAttachImages = useCallback(async () => {
    attachMenu.close();
    const picked = await pickAttachmentImages();
    if (picked.length === 0) {
      return;
    }
    const imagePaths = picked
      .map((path) => path.trim())
      .filter((path) => path.length > 0 && isImageAttachmentPath(path));
    if (imagePaths.length === 0) {
      return;
    }
    clearBareAttachTrigger();
    onAttachImages?.(imagePaths);
  }, [attachMenu, clearBareAttachTrigger, onAttachImages]);
  const handleAttachFiles = useCallback(async () => {
    attachMenu.close();
    const picked = await pickAttachmentFiles();
    const filePaths = picked
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
    if (filePaths.length > 0) {
      insertFileReferences(filePaths);
    }
  }, [attachMenu, insertFileReferences]);
  const handleAttachFolders = useCallback(async () => {
    attachMenu.close();
    const picked = await pickAttachmentFolders();
    const folderPaths = Array.from(
      new Set(picked.map((path) => path.trim()).filter(Boolean)),
    );
    if (folderPaths.length > 0) {
      insertFileReferences(folderPaths);
    }
  }, [attachMenu, insertFileReferences]);
  const handleAttachPlugin = useCallback(
    (plugin: PluginOption) => {
      attachMenu.close();
      insertPluginReference(plugin);
    },
    [attachMenu, insertPluginReference],
  );
  const handleAttachActionTag = useCallback(
    (tag: ComposerActionTag) => {
      attachMenu.close();
      clearBareAttachTrigger();
      const targetMode = collaborationModes.find((mode) =>
        getComposerActionTagForMode(mode) === tag,
      );
      if (!targetMode) {
        return;
      }
      if (activeActionTag === tag) {
        onSelectCollaborationMode(null);
      } else {
        onSelectCollaborationMode(targetMode.id);
      }
    },
    [activeActionTag, attachMenu, clearBareAttachTrigger, collaborationModes, onSelectCollaborationMode],
  );

  const handleTextareaPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      void handlePaste(event);
      if (!event.defaultPrevented) {
        onTextPaste?.(event);
      }
    },
    [handlePaste, onTextPaste],
  );
  const initialEditorTextRef = useRef(text);
  const lexicalInitialConfig = useMemo(
    () => ({
      namespace: "LadonxComposer",
      nodes: [ComposerSkillNode, ComposerPluginNode, ComposerFilePathNode],
      onError(error: Error) {
        throw error;
      },
      editorState(editor: LexicalEditor) {
        editor.update(() => {
          $setComposerEditorText(initialEditorTextRef.current);
        });
      },
      editable: true,
      theme: {
        paragraph: "composer-lexical-paragraph",
      },
    }),
    [],
  );

  const selectedModel =
    models.find((model) => model.id === selectedModelId) ?? null;
  const selectedModelLabel =
    selectedModel?.displayName || selectedModel?.model || "No models";
  const selectedModelDisplayLabel = selectedModelLabel
    .toLowerCase()
    .replace(/^gpt-/i, "")
    .replace(/^deepseek-/i, "")
    .replace(/^claude-/i, "")
    .replace(/^qwen-/i, "")
    .replace(/^zhipu-/i, "")
    .replace(/^minimax-/i, "")
    .replace(/^gemini-/i, "")
    .replace(/^grok-/i, "")
    .replace(/^kimi-/i, "");
  const selectedEffortLabel = formatReasoningEffortLabel(t, selectedEffort);
  const combinedSelectLabel = `${selectedModelDisplayLabel} ${selectedEffortLabel}`;
  const contextUsageMeter = useMemo(
    () => buildContextUsageMeter(contextUsage),
    [contextUsage],
  );
  const accessMenu = useMenuController();
  const accessModeOptions = useMemo(
    () =>
      [
        {
          value: "read-only" as const,
          label: String(t("settings.settingsCodex.readOnly")),
          description: String(t("settings.settingsCodex.readOnlyHelp")),
          Icon: Hand,
        },
        {
          value: "current" as const,
          label: String(t("settings.settingsCodex.onRequest")),
          description: String(t("settings.settingsCodex.onRequestHelp")),
          Icon: SquareTerminal,
        },
        {
          value: "full-access" as const,
          label: String(t("settings.settingsCodex.fullAccess")),
          description: String(t("settings.settingsCodex.fullAccessHelp")),
          Icon: ShieldAlert,
        },
      ],
    [t],
  );
  const selectedAccessModeLabel =
    accessModeOptions.find((option) => option.value === accessMode)?.label ??
    String(t("settings.settingsCodex.accessMode"));
  const AccessModeIcon =
    accessMode === "full-access"
      ? ShieldAlert
      : accessMode === "current"
        ? SquareTerminal
        : Hand;
  const combinedMenu = useMenuController();
  const modelProviderGroups = useMemo(
    () =>
      MODEL_PROVIDER_ORDER.map((provider) => ({
        ...provider,
        models: models.filter((model) => getModelProviderId(model) === provider.id),
      })).filter((provider) => provider.models.length > 0),
    [models],
  );
  const selectedModelProviderId = selectedModel
    ? getModelProviderId(selectedModel)
    : null;
  const [activeModelProviderId, setActiveModelProviderId] =
    useState<ModelProviderId | null>(selectedModelProviderId);
  const activeModelProvider =
    modelProviderGroups.find((provider) => provider.id === activeModelProviderId) ??
    modelProviderGroups.find((provider) => provider.id === selectedModelProviderId) ??
    modelProviderGroups[0] ??
    null;

  useEffect(() => {
    if (!combinedMenu.isOpen) {
      return;
    }
    setActiveModelProviderId(
      selectedModelProviderId ?? modelProviderGroups[0]?.id ?? null,
    );
  }, [combinedMenu.isOpen, modelProviderGroups, selectedModelProviderId]);
  const handleOpenTerminal = useCallback(() => {
    attachMenu.close();
    clearBareAttachTrigger();
    if (onToggleTerminal) {
      onToggleTerminal();
    }
  }, [attachMenu, clearBareAttachTrigger, onToggleTerminal]);

  return (
    <div className={`composer-input${isPhoneLayout && isPhoneTallInput ? " is-phone-tall" : ""}`}>
      {/* 外层输入壳：把文本区、附件区和工具栏包进同一个圆角容器 */}
      <div
        className={`composer-input-area${resolvedIsDragOver ? " is-drag-over" : ""}`}
        ref={resolvedDropTargetRef}
        onDragOver={resolvedHandleDragOver}
        onDragEnter={resolvedHandleDragEnter}
        onDragLeave={resolvedHandleDragLeave}
        onDrop={resolvedHandleDrop}
      >
        <ComposerAttachments
          attachments={attachments}
          disabled={disabled}
          onPreviewAttachment={onPreviewAttachment}
          onRemoveAttachment={onRemoveAttachment}
        />

        {/* 主输入区：只保留写作区域，让视觉焦点先落在文本上 */}
        <div className="composer-input-body">
          <LexicalComposer initialConfig={lexicalInitialConfig}>
            <ComposerLexicalEditor
              disabled={disabled}
              onBridgeSelectionChange={onSelectionChange}
              onDragOver={resolvedHandleDragOver}
              onDragEnter={resolvedHandleDragEnter}
              onDragLeave={resolvedHandleDragLeave}
              onDrop={resolvedHandleDrop}
              onKeyDown={onKeyDown}
              onTextChange={onTextChange}
              onTextPaste={handleTextareaPaste}
              placeholder={
                disabled
                  ? String(t("composer.placeholders.reviewInProgress"))
                  : String(t("composer.placeholders.askCodex"))
              }
              text={text}
              textareaRef={textareaRef}
            />
          </LexicalComposer>
        </div>

          {/* 底部工具栏：左侧是附件和权限，右侧是模型、参数和发送 */}
        <div className="composer-toolbar" style={{ marginTop: 6 }}>
          <div className="composer-toolbar-left">
            <div
              className={`composer-attach-menu${attachMenu.isOpen ? " is-open" : ""}`}
              ref={attachMenu.containerRef}
            >
              <button
                type="button"
                className="composer-attach"
                onClick={attachMenu.toggle}
                disabled={disabled}
                aria-label="Add attachment"
                aria-haspopup="menu"
                aria-expanded={attachMenu.isOpen}
                title="Add attachment"
              >
                <Plus size={15} strokeWidth={1.6} aria-hidden />
              </button>
            </div>

           
            <div
              className={`composer-select-wrap composer-select-wrap--access composer-select-wrap--${accessMode}${
                accessMenu.isOpen ? " is-open" : ""
              }`}
              ref={accessMenu.containerRef}
            >
              <span className={`composer-icon composer-icon--${accessMode}`} aria-hidden>
                <AccessModeIcon strokeWidth={1.6} />
              </span>
              <button
                type="button"
                className={`composer-access-select composer-access-select--${accessMode}`}
                aria-label={String(t("settings.settingsCodex.accessMode"))}
                aria-haspopup="menu"
                aria-expanded={accessMenu.isOpen}
                title={selectedAccessModeLabel}
                onClick={accessMenu.toggle}
                disabled={disabled}
              >
                <span className="composer-access-select-label">
                  {selectedAccessModeLabel}
                </span>
                <span className="composer-access-select-caret" aria-hidden>
                  <ChevronDown size={14} strokeWidth={1.2} />
                </span>
              </button>
              {accessMenu.isOpen && (
                <PopoverSurface className="composer-access-popover" role="menu">
                  {accessModeOptions.map((option) => (
                    <PopoverMenuItem
                      key={option.value}
                      active={accessMode === option.value}
                      icon={<option.Icon strokeWidth={1.6} />}
                      description={option.description}
                      onClick={() => {
                        onSelectAccessMode(option.value);
                        accessMenu.close();
                      }}
                    >
                      {option.label}
                    </PopoverMenuItem>
                  ))}
                </PopoverSurface>
              )}
            </div>
            {activeActionTag ? (
              <div className="composer-action-tags" aria-label="Selected actions">
                {[activeActionTag].map((tag) => {
                  const TagIcon = tag === "plan" ? ListTodo : Target;
                  const label = COMPOSER_ACTION_TAG_LABELS[tag];
                  return (
                    <span key={tag} className={`composer-action-tag composer-action-tag--${tag}`}>
                      <span className="composer-icon composer-action-tag-leading">
                        <TagIcon strokeWidth={1.6} />
                        <button
                          type="button"
                          className="composer-action-tag-remove"
                          aria-label={`移除${label}`}
                          title={`移除${label}`}
                          onClick={() => handleAttachActionTag(tag)}
                          disabled={disabled}
                        >
                          <X size={12} strokeWidth={1.8} aria-hidden />
                        </button>
                      </span>
                      <span className="composer-action-tag-label">{label}</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div className="composer-toolbar-right">
            <div
              className={`composer-select-wrap composer-select-wrap--combined${
                combinedMenu.isOpen ? " is-open" : ""
              }`}
              ref={combinedMenu.containerRef}
            >
              {contextUsageMeter ? (
                <span
                  className={`composer-context-ring composer-context-ring--inline${
                    contextUsageMeter.usedPercent >= 90
                      ? " is-critical"
                      : contextUsageMeter.usedPercent >= 75
                        ? " is-warn"
                        : ""
                  }`}
                  role="meter"
                  aria-label={contextUsageMeter.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={contextUsageMeter.usedPercent}
                  aria-valuetext={contextUsageMeter.label}
                  style={
                    {
                      "--context-used": contextUsageMeter.usedPercent,
                    } as React.CSSProperties
                  }
                >
                  <span className="composer-context-tooltip" role="tooltip">
                    <span className="composer-context-tooltip-row">
                      <span className="composer-context-tooltip-label">上下文容量</span>
                      <span className="composer-context-tooltip-value">
                        {contextUsageMeter.capacityLabel}
                      </span>
                    </span>
                    <span className="composer-context-tooltip-track" aria-hidden>
                      <span
                        className="composer-context-tooltip-fill"
                        style={
                          {
                            "--context-used": contextUsageMeter.usedPercent,
                          } as React.CSSProperties
                        }
                      />
                    </span>
                    <span className="composer-context-tooltip-row">
                      <span className="composer-context-tooltip-label">平均缓存命中率</span>
                      <span className="composer-context-tooltip-value">
                        {contextUsageMeter.cacheHitLabel}
                      </span>
                    </span>
                  </span>
                </span>
              ) : null}
              <button
                type="button"
                className="composer-combined-select"
                aria-label={combinedSelectLabel}
                aria-haspopup="menu"
                aria-expanded={combinedMenu.isOpen}
                disabled={disabled}
                onClick={combinedMenu.toggle}
                title={combinedSelectLabel}
              >
                <span className="composer-combined-select-model">
                  {selectedModelDisplayLabel}
                </span>
                <span className="composer-combined-select-effort">
                  {selectedEffortLabel}
                </span>
                {selectedEffort === "low" && (
                  <span
                    className="composer-fast-indicator"
                    role="status"
                    aria-label="Fast mode enabled"
                    title="Fast mode enabled"
                  >
                    <Zap size={12} strokeWidth={1.2} />
                  </span>
                )}
                <span className="composer-combined-select-caret" aria-hidden>
                  <ChevronDown size={14} strokeWidth={1.2} />
                </span>
              </button>
              {combinedMenu.isOpen && (
                <PopoverSurface className="composer-combined-popover" role="menu">
                  <div className="composer-combined-section">
                    <div className="composer-combined-section-title">
                      {String(t("composer.labels.intelligence"))}
                    </div>
                    {REASONING_EFFORT_OPTIONS.map((effort) => (
                      <PopoverMenuItem
                        key={effort}
                        active={selectedEffort === effort}
                        className="composer-effort-menu-item"
                        disabled={!reasoningSupported}
                        onClick={() => {
                          onSelectEffort(effort);
                          combinedMenu.close();
                        }}
                      >
                        {formatReasoningEffortLabel(t, effort)}
                      </PopoverMenuItem>
                    ))}
                  </div>
                  <div className="composer-combined-divider" aria-hidden />
                  <div className="composer-combined-section">
                    <div className="composer-combined-section-title">
                      {String(t("composer.labels.model"))}
                    </div>
                    {modelProviderGroups.length === 0 ? (
                      <div className="composer-combined-empty">No models</div>
                    ) : (
                      isPhoneLayout ? (
                        <div className="composer-mobile-model-groups">
                          {modelProviderGroups.map((provider) => (
                            <div
                              key={provider.id}
                              className="composer-mobile-model-group"
                            >
                              <div className="composer-mobile-model-group-header">
                                <span className="composer-mobile-model-group-label">
                                  {String(t(provider.labelKey))}
                                </span>
                                <span className="composer-model-provider-meta">
                                  {provider.models.length}
                                </span>
                              </div>
                              <div className="composer-mobile-model-group-list">
                                {provider.models.map((model) => (
                                  <PopoverMenuItem
                                    key={model.id}
                                    active={selectedModelId === model.id}
                                    onClick={() => {
                                      onSelectModel(model.id);
                                      combinedMenu.close();
                                    }}
                                  >
                                    {model.displayName || model.model}
                                  </PopoverMenuItem>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="composer-model-provider-menu">
                          <div className="composer-model-provider-list">
                            {modelProviderGroups.map((provider) => (
                              <PopoverMenuItem
                                key={provider.id}
                                active={activeModelProvider?.id === provider.id}
                                className="composer-model-provider-item"
                                aria-haspopup="menu"
                                onFocus={() => setActiveModelProviderId(provider.id)}
                                onMouseEnter={() => setActiveModelProviderId(provider.id)}
                                onClick={() => setActiveModelProviderId(provider.id)}
                              >
                                <span className="composer-model-provider-label">
                                  {String(t(provider.labelKey))}
                                </span>
                                <span className="composer-model-provider-meta">
                                  {provider.models.length}
                                </span>
                                <ChevronRight size={14} strokeWidth={1.2} aria-hidden />
                              </PopoverMenuItem>
                            ))}
                          </div>
                          {activeModelProvider && (
                            <PopoverSurface className="composer-model-submenu" role="menu">
                              {activeModelProvider.models.map((model) => (
                                <PopoverMenuItem
                                  key={model.id}
                                  active={selectedModelId === model.id}
                                  onClick={() => {
                                    onSelectModel(model.id);
                                    combinedMenu.close();
                                  }}
                                >
                                  {model.displayName || model.model}
                                </PopoverMenuItem>
                              ))}
                            </PopoverSurface>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </PopoverSurface>
              )}
            </div>

            <button
              type="button"
              className={`composer-action${
                canStop
                  ? " is-stop"
                  : showDictationButton
                    ? " composer-action--mic"
                    : " is-send"
              }${canStop && isProcessing ? " is-loading" : ""}${
                showDictationButton && isDictationActive ? " is-active" : ""
              }${showDictationButton && isDictationProcessing ? " is-processing" : ""}`}
              onClick={handleActionClick}
              disabled={
                (disabled && !canStop) ||
                (!canStop &&
                  (showDictationButton ? !canUseDictationButton : !canSend))
              }
              aria-label={canStop ? "Stop" : showDictationButton ? "Start dictation" : sendLabel}
              title={canStop ? "Stop" : showDictationButton ? "Start dictation" : sendLabel}
            >
              {canStop ? (
                <>
                  <span className="composer-action-stop-square" aria-hidden />
                  {isProcessing && (
                    <span className="composer-action-spinner" aria-hidden />
                  )}
                </>
              ) : showDictationButton ? (
                <Mic size={14} strokeWidth={1.2} aria-hidden />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 5v14M12 5l-7 7M12 5l7 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>

        <ComposerSuggestionsPopover
          highlightIndex={highlightIndex}
          highlightedBranchIndex={highlightedBranchIndex}
          highlightedCommitIndex={highlightedCommitIndex}
          highlightedPresetIndex={highlightedPresetIndex}
          onHighlightIndex={onHighlightIndex}
          onReviewPromptChoosePreset={onReviewPromptChoosePreset}
          onReviewPromptClose={onReviewPromptClose}
          onReviewPromptConfirmBranch={onReviewPromptConfirmBranch}
          onReviewPromptConfirmCommit={onReviewPromptConfirmCommit}
          onReviewPromptConfirmCustom={onReviewPromptConfirmCustom}
          onReviewPromptHighlightBranch={onReviewPromptHighlightBranch}
          onReviewPromptHighlightCommit={onReviewPromptHighlightCommit}
          onReviewPromptHighlightPreset={onReviewPromptHighlightPreset}
          onReviewPromptSelectBranch={onReviewPromptSelectBranch}
          onReviewPromptSelectBranchAtIndex={onReviewPromptSelectBranchAtIndex}
          onReviewPromptSelectCommit={onReviewPromptSelectCommit}
          onReviewPromptSelectCommitAtIndex={onReviewPromptSelectCommitAtIndex}
          onReviewPromptShowPreset={onReviewPromptShowPreset}
          onReviewPromptUpdateCustomInstructions={onReviewPromptUpdateCustomInstructions}
          onSelectSuggestion={onSelectSuggestion}
          reviewPrompt={reviewPrompt}
          suggestionListRef={suggestionListRef}
          suggestionRefs={suggestionRefs}
          suggestions={suggestions}
          suggestionsOpen={suggestionsOpen && !bareAttachTriggerActive}
          suggestionsStyle={suggestionsStyle}
        />
        <ComposerAttachPopover
          open={attachMenu.isOpen}
          plugins={plugins}
          selectedActionTags={activeActionTag ? [activeActionTag] : []}
          onAttachActionTag={handleAttachActionTag}
          onOpenTerminal={handleOpenTerminal}
          onAttachFiles={() => {
            void handleAttachFiles();
          }}
          onAttachFolders={() => {
            void handleAttachFolders();
          }}
          onAttachImages={() => {
            void handleAttachImages();
          }}
          onAttachPlugin={handleAttachPlugin}
        />
      </div>
    </div>
  );
}
