import { useCallback, useMemo, type MouseEvent } from "react";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { WorkspaceInfo } from "../../../types";
import { readThread } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { fileManagerName } from "../../../utils/platformPaths";
import { useI18nSafe } from "../../../hooks/useI18nSafe";
import { extractThreadFilePathFromResponse } from "../../threads/utils/threadSummary";

type SidebarMenuHandlers = {
  workspaces: WorkspaceInfo[];
  onDeleteThread: (workspaceId: string, threadId: string) => Promise<void>;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  onPinThread: (workspaceId: string, threadId: string) => void;
  onUnpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
};

export function useSidebarMenus({
  workspaces,
  onDeleteThread,
  onSyncThread,
  onPinThread,
  onUnpinThread,
  isThreadPinned,
  onRenameThread,
  onReloadWorkspaceThreads,
  onDeleteWorkspace,
  onDeleteWorktree,
}: SidebarMenuHandlers) {
  const { t } = useI18nSafe();
  const workspaceSourceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.source])),
    [workspaces],
  );
  const revealThreadPath = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      source: WorkspaceInfo["source"],
      filePath?: string | null,
    ) => {
      const directPath = typeof filePath === "string" ? filePath.trim() : "";
      if (source === "claude_code") {
        return directPath || null;
      }
      try {
        const response = await readThread(workspaceId, threadId);
        return extractThreadFilePathFromResponse(response) ?? (directPath || null);
      } catch {
        return directPath || null;
      }
    },
    [],
  );
  const showThreadMenu = useCallback(
    async (
      event: MouseEvent,
      workspaceId: string,
      threadId: string,
      canPin: boolean,
      filePath?: string | null,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const source = workspaceSourceById.get(workspaceId) ?? "codex";
      const providerLabel = source === "claude_code" ? "Claude Code" : "Codex";
      const fileManagerLabel = fileManagerName();
      const renameItem = await MenuItem.new({
        text: String(t('sidebar.rename')),
        action: () => onRenameThread(workspaceId, threadId),
      });
      const syncItem = await MenuItem.new({
        text: String(t('sidebar.syncFromServer')),
        action: () => onSyncThread(workspaceId, threadId),
      });
      const archiveItem = await MenuItem.new({
        text: String(t('sidebar.archive')),
        action: () => void onDeleteThread(workspaceId, threadId).catch((error) => {
          pushErrorToast({
            title: String(t("sidebar.deleteThreadFailed")),
            message: error instanceof Error ? error.message : String(error),
          });
        }),
      });
      const deleteItem = await MenuItem.new({
        text: String(t('sidebar.delete')),
        action: () => void onDeleteThread(workspaceId, threadId).catch((error) => {
          pushErrorToast({
            title: String(t("sidebar.deleteThreadFailed")),
            message: error instanceof Error ? error.message : String(error),
          });
        }),
      });
      const copyItem = await MenuItem.new({
        text: String(
          source === "claude_code"
            ? t("sidebar.copyClaudeCodeSessionId")
            : t("sidebar.copyId"),
        ),
        action: async () => {
          try {
            await navigator.clipboard.writeText(threadId);
          } catch {
            // Clipboard failures are non-fatal here.
          }
        },
      });
      const revealItem = await MenuItem.new({
        text: String(
          source === "claude_code"
            ? t("sidebar.showClaudeCodeLogIn", { app: fileManagerLabel })
            : t("sidebar.showIn", { app: fileManagerLabel }),
        ),
        enabled: true,
        action: async () => {
          const resolvedPath = await revealThreadPath(
            workspaceId,
            threadId,
            source,
            filePath,
          );
          if (!resolvedPath) {
            pushErrorToast({
              title: String(
                t("sidebar.revealChatLogErrorTitle", {
                  provider: providerLabel,
                  app: fileManagerLabel,
                }),
              ),
              message: String(t("sidebar.threadLogPathUnavailable")),
            });
            return;
          }
          try {
            const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
            await revealItemInDir(resolvedPath);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushErrorToast({
              title: String(
                t("sidebar.revealChatLogErrorTitle", {
                  provider: providerLabel,
                  app: fileManagerLabel,
                }),
              ),
              message,
            });
            console.warn(`Failed to reveal ${providerLabel} chat log`, {
              message,
              workspaceId,
              threadId,
              path: resolvedPath,
            });
          }
        },
      });
      const items = source === "codex" ? [renameItem, syncItem] : [];
      if (canPin) {
        const isPinned = isThreadPinned(workspaceId, threadId);
        items.push(
          await MenuItem.new({
            text: String(t(isPinned ? 'sidebar.unpin' : 'sidebar.pin')),
            action: () => {
              if (isPinned) {
                onUnpinThread(workspaceId, threadId);
              } else {
                onPinThread(workspaceId, threadId);
              }
            },
          }),
        );
      }
      items.push(copyItem, revealItem);
      items.push(...(source === "codex" ? [archiveItem, deleteItem] : [deleteItem]));
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      isThreadPinned,
      onDeleteThread,
      onPinThread,
      revealThreadPath,
      onRenameThread,
      onSyncThread,
      onUnpinThread,
      t,
      workspaceSourceById,
    ],
  );

  const showWorkspaceMenu = useCallback(
    async (event: MouseEvent, workspaceId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const source = workspaceSourceById.get(workspaceId) ?? "codex";
      const reloadItem = await MenuItem.new({
        text: String(
          source === "claude_code"
            ? t("sidebar.reloadClaudeCodeThreads")
            : t("sidebar.reloadThreads"),
        ),
        action: () => onReloadWorkspaceThreads(workspaceId),
      });
      const deleteItem = await MenuItem.new({
        text: String(
          source === "claude_code"
            ? t("sidebar.deleteClaudeCodeWorkspace")
            : t("sidebar.delete"),
        ),
        action: () => onDeleteWorkspace(workspaceId),
      });
      const menu = await Menu.new({ items: [reloadItem, deleteItem] });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [onReloadWorkspaceThreads, onDeleteWorkspace, t, workspaceSourceById],
  );

  const showWorktreeMenu = useCallback(
    async (event: MouseEvent, worktree: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      const fileManagerLabel = fileManagerName();
      const reloadItem = await MenuItem.new({
        text: String(t('sidebar.reloadThreads')),
        action: () => onReloadWorkspaceThreads(worktree.id),
      });
      const revealItem = await MenuItem.new({
        text: String(t('sidebar.showIn', { app: fileManagerLabel })),
        action: async () => {
          if (!worktree.path) {
            return;
          }
          try {
            const { revealItemInDir } = await import(
              "@tauri-apps/plugin-opener"
            );
            await revealItemInDir(worktree.path);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushErrorToast({
              title: String(t("sidebar.revealWorktreeErrorTitle", { app: fileManagerLabel })),
              message,
            });
            console.warn("Failed to reveal worktree", {
              message,
              workspaceId: worktree.id,
              path: worktree.path,
            });
          }
        },
      });
      const deleteItem = await MenuItem.new({
        text: String(t('sidebar.deleteWorktree')),
        action: () => onDeleteWorktree(worktree.id),
      });
      const menu = await Menu.new({ items: [reloadItem, revealItem, deleteItem] });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [onReloadWorkspaceThreads, onDeleteWorktree, t],
  );

  const showCloneMenu = useCallback(
    async (event: MouseEvent, clone: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      const fileManagerLabel = fileManagerName();
      const reloadItem = await MenuItem.new({
        text: String(t('sidebar.reloadThreads')),
        action: () => onReloadWorkspaceThreads(clone.id),
      });
      const revealItem = await MenuItem.new({
        text: String(t('sidebar.showIn', { app: fileManagerLabel })),
        action: async () => {
          if (!clone.path) {
            return;
          }
          try {
            const { revealItemInDir } = await import(
              "@tauri-apps/plugin-opener"
            );
            await revealItemInDir(clone.path);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            pushErrorToast({
              title: String(t("sidebar.revealCloneErrorTitle", { app: fileManagerLabel })),
              message,
            });
            console.warn("Failed to reveal clone", {
              message,
              workspaceId: clone.id,
              path: clone.path,
            });
          }
        },
      });
      const deleteItem = await MenuItem.new({
        text: String(t('sidebar.deleteClone')),
        action: () => onDeleteWorkspace(clone.id),
      });
      const menu = await Menu.new({ items: [reloadItem, revealItem, deleteItem] });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [onReloadWorkspaceThreads, onDeleteWorkspace, t],
  );

  return {
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    showCloneMenu,
  };
}
