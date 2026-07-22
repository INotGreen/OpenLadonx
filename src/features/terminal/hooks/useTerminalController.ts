import { useCallback, useEffect, useRef, useState } from "react";
import type { DebugEntry, WorkspaceInfo } from "../../../types";
import { closeTerminalSession } from "../../../services/tauri";
import { buildErrorDebugEntry } from "../../../utils/debugEntries";
import { useTerminalSession } from "./useTerminalSession";
import { useTerminalTabs } from "./useTerminalTabs";

type UseTerminalControllerOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  terminalOpen: boolean;
  layoutResizeKey?: string | number;
  onCloseTerminalPanel?: () => void;
  onDebug: (entry: DebugEntry) => void;
  onPreviewFile?: (path: string) => void;
};

export function useTerminalController({
  activeWorkspace,
  activeThreadId,
  terminalOpen,
  layoutResizeKey,
  onCloseTerminalPanel,
  onDebug,
  onPreviewFile,
}: UseTerminalControllerOptions) {
  const cleanupTerminalRef = useRef<((workspaceId: string, terminalId: string) => void) | null>(
    null,
  );
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
  const requestTerminalFocus = useCallback(() => {
    setFocusRequestVersion((prev) => prev + 1);
  }, []);
  const shouldIgnoreTerminalCloseError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Terminal session not found");
  }, []);

  const handleTerminalClose = useCallback(
    async (workspaceId: string, terminalId: string) => {
      cleanupTerminalRef.current?.(workspaceId, terminalId);
      try {
        await closeTerminalSession(workspaceId, terminalId);
      } catch (error) {
        if (shouldIgnoreTerminalCloseError(error)) {
          return;
        }
        onDebug(buildErrorDebugEntry("terminal close error", error));
      }
    },
    [onDebug, shouldIgnoreTerminalCloseError],
  );

  const {
    terminals: terminalTabs,
    activeTerminalId,
    createTerminal,
    ensureTerminalWithTitle,
    closeTerminal,
    setActiveTerminal,
    ensureTerminal,
  } = useTerminalTabs({
    activeScopeId: activeThreadId,
    onCloseTerminal: handleTerminalClose,
  });

  useEffect(() => {
    if (terminalOpen && activeThreadId) {
      ensureTerminal(activeThreadId, activeWorkspace?.path ?? "");
    }
  }, [activeWorkspace?.path, activeThreadId, ensureTerminal, terminalOpen]);

  const terminalState = useTerminalSession({
    activeWorkspace,
    activeTerminalId,
    terminalScopeId: activeThreadId,
    isVisible: terminalOpen,
    layoutResizeKey,
    focusRequestVersion,
    onDebug,
    onPreviewFile,
    onSessionExit: (workspaceId, terminalId) => {
      const shouldClosePanel =
        workspaceId === activeThreadId &&
        terminalTabs.length === 1 &&
        terminalTabs[0]?.id === terminalId;
      closeTerminal(workspaceId, terminalId);
      if (shouldClosePanel) {
        onCloseTerminalPanel?.();
      }
    },
  });

  useEffect(() => {
    cleanupTerminalRef.current = terminalState.cleanupTerminalSession;
  }, [terminalState.cleanupTerminalSession]);

  const onSelectTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadId) {
        return;
      }
      requestTerminalFocus();
      setActiveTerminal(activeThreadId, terminalId);
    },
    [activeThreadId, requestTerminalFocus, setActiveTerminal],
  );

  const onNewTerminal = useCallback(() => {
    if (!activeThreadId) {
      return null;
    }
    requestTerminalFocus();
    return createTerminal(activeThreadId, activeWorkspace?.path ?? "");
  }, [activeWorkspace?.path, activeThreadId, createTerminal, requestTerminalFocus]);

  const onCloseTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadId) {
        return;
      }
      const shouldClosePanel =
        terminalTabs.length === 1 && terminalTabs[0]?.id === terminalId;
      closeTerminal(activeThreadId, terminalId);
      if (shouldClosePanel) {
        onCloseTerminalPanel?.();
      }
    },
    [activeThreadId, closeTerminal, onCloseTerminalPanel, terminalTabs],
  );

  const restartTerminalSession = useCallback(
    async (workspaceId: string, terminalId: string) => {
      cleanupTerminalRef.current?.(workspaceId, terminalId);
      try {
        await closeTerminalSession(workspaceId, terminalId);
      } catch (error) {
        if (!shouldIgnoreTerminalCloseError(error)) {
          onDebug(buildErrorDebugEntry("terminal close error", error));
          throw error;
        }
      }
    },
    [onDebug, shouldIgnoreTerminalCloseError],
  );

  return {
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureTerminalWithTitle,
    restartTerminalSession,
    requestTerminalFocus,
  };
}
