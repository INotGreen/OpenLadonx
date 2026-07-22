import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import Plus from "lucide-react/dist/esm/icons/plus";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import File from "lucide-react/dist/esm/icons/file";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Search from "lucide-react/dist/esm/icons/search";
import type { PanelTabId } from "./PanelTabs";
import { PanelShell } from "./PanelShell";
import {
  PanelMeta,
  PanelSearchField,
} from "../../design-system/components/panel/PanelPrimitives";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import {
  writeAttachmentPathsToDataTransfer,
} from "../../../utils/attachmentDragData";
import {
  beginAttachmentDragSession,
  getAttachmentDragHoveringComposer,
  scheduleAttachmentDragSessionClear,
} from "../../../utils/attachmentDragSession";
import {
  isAbsolutePath,
  joinWorkspacePath,
  revealInFileManagerLabel,
} from "../../../utils/platformPaths";
import { getFileTypeIconUrl, getFolderTypeIconUrl } from "../../../utils/fileTypeIcons";
import { useI18nSafe } from "../../../hooks/useI18nSafe";

type FileTreeNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: FileTreeNode[];
};

type FileTreePanelProps = {
  workspaceId: string;
  workspacePath: string;
  files: string[];
  modifiedFiles: string[];
  isLoading: boolean;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  showPanelTabs?: boolean;
  onInsertText?: (text: string) => void;
  onAttachFile?: (path: string) => void;
  canInsertText: boolean;
  onPreviewFile?: (path: string) => void;
};

type FileTreeBuildNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  children: Map<string, FileTreeBuildNode>;
};

type FileEntry = {
  path: string;
  lower: string;
  segments: string[];
};

type FileTreeRowEntry = {
  node: FileTreeNode;
  depth: number;
  isFolder: boolean;
  isExpanded: boolean;
};

const FILE_TREE_ROW_HEIGHT = 28;

function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function toWorkspaceRelativePath(path: string, workspacePath: string) {
  const normalizedPath = normalizeComparablePath(path);
  if (!normalizedPath) {
    return "";
  }
  if (!isAbsolutePath(normalizedPath)) {
    return normalizedPath.replace(/^\/+/, "");
  }
  const normalizedWorkspacePath = normalizeComparablePath(workspacePath);
  if (
    normalizedWorkspacePath &&
    normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
  ) {
    return normalizedPath.slice(normalizedWorkspacePath.length + 1);
  }
  return normalizedPath.replace(/^\/+/, "");
}

function buildTree(entries: FileEntry[]): { nodes: FileTreeNode[]; folderPaths: Set<string> } {
  const root = new Map<string, FileTreeBuildNode>();
  const addNode = (
    map: Map<string, FileTreeBuildNode>,
    name: string,
    path: string,
    type: "file" | "folder",
  ) => {
    const existing = map.get(name);
    if (existing) {
      if (type === "folder") {
        existing.type = "folder";
      }
      return existing;
    }
    const node: FileTreeBuildNode = {
      name,
      path,
      type,
      children: new Map(),
    };
    map.set(name, node);
    return node;
  };

  entries.forEach(({ segments }) => {
    if (!segments.length) {
      return;
    }
    let currentMap = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      const node = addNode(currentMap, segment, nextPath, isFile ? "file" : "folder");
      if (!isFile) {
        currentMap = node.children;
        currentPath = nextPath;
      }
    });
  });

  const folderPaths = new Set<string>();

  const toArray = (map: Map<string, FileTreeBuildNode>): FileTreeNode[] => {
    const nodes = Array.from(map.values()).map((node) => {
      if (node.type === "folder") {
        folderPaths.add(node.path);
      }
      return {
        name: node.name,
        path: node.path,
        type: node.type,
        children: node.type === "folder" ? toArray(node.children) : [],
      };
    });
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    return nodes;
  };

  return { nodes: toArray(root), folderPaths };
}

export function FileTreePanel({
  workspacePath,
  files,
  modifiedFiles,
  isLoading,
  filePanelMode,
  onFilePanelModeChange,
  showPanelTabs = true,
  onInsertText,
  onAttachFile,
  canInsertText,
  onPreviewFile,
}: FileTreePanelProps) {
  const { t } = useI18nSafe();
  const [filterMode, setFilterMode] = useState<"all" | "modified">("all");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const hasManualToggle = useRef(false);
  const showLoading = isLoading && files.length === 0;
  const listRef = useRef<HTMLDivElement | null>(null);
  const debouncedQuery = useDebouncedValue(query, 150);
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const normalizedFiles = useMemo(
    () =>
      files
        .map((path) => toWorkspaceRelativePath(path, workspacePath))
        .filter(Boolean),
    [files, workspacePath],
  );
  const normalizedModifiedFiles = useMemo(
    () =>
      modifiedFiles
        .map((path) => toWorkspaceRelativePath(path, workspacePath))
        .filter(Boolean),
    [modifiedFiles, workspacePath],
  );
  const modifiedPathSet = useMemo(
    () => new Set(normalizedModifiedFiles),
    [normalizedModifiedFiles],
  );
  const fileEntries = useMemo(
    () =>
      normalizedFiles.map((path) => ({
        path,
        lower: path.toLowerCase(),
        segments: path.split("/").filter(Boolean),
      })),
    [normalizedFiles],
  );
  const sourceEntries = useMemo(
    () =>
      filterMode === "modified"
        ? fileEntries.filter((entry) => modifiedPathSet.has(entry.path))
        : fileEntries,
    [fileEntries, filterMode, modifiedPathSet],
  );
  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) {
      return sourceEntries;
    }
    return sourceEntries.filter((entry) => entry.lower.includes(normalizedQuery));
  }, [sourceEntries, normalizedQuery]);

  const { nodes, folderPaths } = useMemo(
    () => buildTree(visibleEntries),
    [visibleEntries],
  );

  const visibleFolderPaths = folderPaths;
  const hasFolders = visibleFolderPaths.size > 0;
  const allVisibleExpanded =
    hasFolders && Array.from(visibleFolderPaths).every((path) => expandedFolders.has(path));

  useEffect(() => {
    setExpandedFolders((prev) => {
      if (normalizedQuery || filterMode === "modified") {
        return new Set(folderPaths);
      }
      const next = new Set<string>();
      prev.forEach((path) => {
        if (folderPaths.has(path)) {
          next.add(path);
        }
      });
      if (next.size === 0 && !hasManualToggle.current) {
        nodes.forEach((node) => {
          if (node.type === "folder") {
            next.add(node.path);
          }
        });
      }
      return next;
    });
  }, [filterMode, folderPaths, nodes, normalizedQuery]);

  const toggleAllFolders = () => {
    if (!hasFolders) {
      return;
    }
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (allVisibleExpanded) {
        visibleFolderPaths.forEach((path) => next.delete(path));
      } else {
        visibleFolderPaths.forEach((path) => next.add(path));
      }
      return next;
    });
    hasManualToggle.current = true;
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const resolvePath = useCallback(
    (relativePath: string) => {
      return joinWorkspacePath(workspacePath, relativePath);
    },
    [workspacePath],
  );

  const flatNodes = useMemo(() => {
    const rows: FileTreeRowEntry[] = [];
    const walk = (node: FileTreeNode, depth: number) => {
      const isFolder = node.type === "folder";
      const isExpanded = isFolder && expandedFolders.has(node.path);
      rows.push({ node, depth, isFolder, isExpanded });
      if (isFolder && isExpanded) {
        node.children.forEach((child) => walk(child, depth + 1));
      }
    };
    nodes.forEach((node) => walk(node, 0));
    return rows;
  }, [nodes, expandedFolders]);

  const rowVirtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => FILE_TREE_ROW_HEIGHT,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  const showMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>, relativePath: string) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = await Menu.new({
        items: [
          await MenuItem.new({
            text: String(t("fileTree.addToChat")),
            enabled: canInsertText,
            action: async () => {
              if (!canInsertText) {
                return;
              }
              onInsertText?.(relativePath);
            },
          }),
          await MenuItem.new({
            text: revealInFileManagerLabel(),
            action: async () => {
              await revealItemInDir(resolvePath(relativePath));
            },
          }),
        ],
      });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [canInsertText, onInsertText, resolvePath, t],
  );

  const handleRowDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, relativePath: string) => {
      if (!canInsertText) {
        event.preventDefault();
        return;
      }
      const resolvedPath = resolvePath(relativePath);
      beginAttachmentDragSession([resolvedPath]);
      writeAttachmentPathsToDataTransfer(event.dataTransfer, [resolvedPath]);
    },
    [canInsertText, resolvePath],
  );

  const handleRowPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, relativePath: string) => {
      if (!canInsertText || event.button !== 0) {
        return;
      }
      const resolvedPath = resolvePath(relativePath);
      beginAttachmentDragSession([resolvedPath]);
    },
    [canInsertText, resolvePath],
  );

  const handleRowDragEnd = useCallback(
    (event: DragEvent<HTMLButtonElement>, relativePath: string) => {
      const releasedOverComposer = (() => {
        if (typeof document === "undefined") {
          return false;
        }
        const element = document.elementFromPoint(event.clientX, event.clientY);
        return Boolean(
          element?.closest(".composer-input-area, .messages, .chat-pane"),
        );
      })();
      const resolvedPath = resolvePath(relativePath);
      const shouldAttach = getAttachmentDragHoveringComposer() || releasedOverComposer;
      if (shouldAttach) {
        onAttachFile?.(resolvedPath);
      }
      scheduleAttachmentDragSessionClear();
    },
    [onAttachFile, resolvePath],
  );

  const renderRow = (entry: FileTreeRowEntry) => {
    const { node, depth, isFolder, isExpanded } = entry;
    const folderTypeIconUrl = isFolder ? getFolderTypeIconUrl(node.path, isExpanded) : null;
    const fileTypeIconUrl = isFolder ? null : getFileTypeIconUrl(node.path);
    return (
      <div className="file-tree-row-wrap">
        <button
          type="button"
          className={`file-tree-row${isFolder ? " is-folder" : " is-file"}`}
          draggable={canInsertText}
          style={{ paddingLeft: `${depth * 10}px` }}
          onPointerDown={(event) => handleRowPointerDown(event, node.path)}
          onDragStart={(event) => handleRowDragStart(event, node.path)}
          onDragEnd={(event) => handleRowDragEnd(event, node.path)}
          onClick={() => {
            if (isFolder) {
              scheduleAttachmentDragSessionClear(0);
              toggleFolder(node.path);
              return;
            }
            scheduleAttachmentDragSessionClear(0);
            onPreviewFile?.(resolvePath(node.path));
          }}
          onContextMenu={(event) => {
            void showMenu(event, node.path);
          }}
        >
          {isFolder ? (
            <span className={`file-tree-chevron${isExpanded ? " is-open" : ""}`}>
              ›
            </span>
          ) : (
            <span className="file-tree-spacer" aria-hidden />
          )}
          <span className="file-tree-icon" aria-hidden>
            {isFolder ? (
              folderTypeIconUrl ? (
                <img
                  className="file-tree-icon-image"
                  src={folderTypeIconUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <File size={12} />
              )
            ) : fileTypeIconUrl ? (
              <img
                className="file-tree-icon-image"
                src={fileTypeIconUrl}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : (
              <File size={12} />
            )}
          </span>
          <span className="file-tree-name">{node.name}</span>
        </button>
        {!isFolder && (
          <button
            type="button"
            className="ghost icon-button file-tree-action"
            onClick={(event) => {
              event.stopPropagation();
              if (!canInsertText) {
                return;
              }
              onAttachFile?.(resolvePath(node.path));
            }}
            disabled={!canInsertText}
            aria-label={`Mention ${node.name}`}
            title="Mention in chat"
          >
            <Plus size={10} aria-hidden />
          </button>
        )}
      </div>
    );
  };

  const headerRight = (
    <PanelMeta className="file-tree-meta">
      <div className="file-tree-count">
        {visibleEntries.length
          ? normalizedQuery
            ? `${visibleEntries.length} match${visibleEntries.length === 1 ? "" : "es"}`
            : filterMode === "modified"
              ? `${visibleEntries.length} modified`
              : `${visibleEntries.length} file${visibleEntries.length === 1 ? "" : "s"}`
          : showLoading
            ? "Loading files"
            : filterMode === "modified"
              ? "No modified"
              : "No files"}
      </div>
      {hasFolders ? (
        <button
          type="button"
          className="ghost icon-button file-tree-toggle"
          onClick={toggleAllFolders}
          aria-label={allVisibleExpanded ? "Collapse all folders" : "Expand all folders"}
          title={allVisibleExpanded ? "Collapse all folders" : "Expand all folders"}
        >
          <ChevronsUpDown aria-hidden />
        </button>
      ) : null}
    </PanelMeta>
  );

  const searchNode = (
    <PanelSearchField
      className="file-tree-search"
      inputClassName="file-tree-search-input"
      placeholder="Filter files and folders"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      aria-label="Filter files and folders"
      icon={<Search aria-hidden />}
      trailing={
        <button
          type="button"
          className={`ghost icon-button file-tree-search-filter${filterMode === "modified" ? " is-active" : ""}`}
          onClick={() => {
            setFilterMode((prev) => (prev === "all" ? "modified" : "all"));
          }}
          aria-pressed={filterMode === "modified"}
          aria-label={
            filterMode === "modified" ? "Show all files" : "Show modified files only"
          }
          title={filterMode === "modified" ? "Show all files" : "Show modified files only"}
        >
          <GitBranch size={14} aria-hidden />
        </button>
      }
    />
  );

  const contentNode = (
    <div
      className="file-tree-list"
      ref={listRef}
      style={{ ["--file-tree-row-height" as string]: `${FILE_TREE_ROW_HEIGHT}px` }}
    >
      {showLoading ? (
        <div className="file-tree-skeleton">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              className="file-tree-skeleton-row"
              key={`file-tree-skeleton-${index}`}
              style={{ width: `${68 + index * 3}%` }}
            />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <div className="file-tree-empty">
          {normalizedQuery
            ? filterMode === "modified"
              ? "No modified files match your filter."
              : "No matches found."
            : filterMode === "modified"
              ? "No modified files."
              : "No files available."}
        </div>
      ) : (
        <div
          className="file-tree-virtual"
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {virtualRows.map((virtualRow) => {
            const entry = flatNodes[virtualRow.index];
            if (!entry) {
              return null;
            }
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${FILE_TREE_ROW_HEIGHT}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {renderRow(entry)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (!showPanelTabs) {
    return (
      <div className="file-tree-panel">
        <div className="git-panel-header">{headerRight}</div>
        {searchNode}
        {contentNode}
      </div>
    );
  }

  return (
    <PanelShell
      filePanelMode={filePanelMode}
      onFilePanelModeChange={onFilePanelModeChange}
      className="file-tree-panel"
      headerClassName="git-panel-header"
      headerRight={headerRight}
      search={searchNode}
    >
      {contentNode}
    </PanelShell>
  );
}
