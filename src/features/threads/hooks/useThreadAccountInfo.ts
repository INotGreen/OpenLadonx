import { useCallback, useEffect } from "react";
import type { DebugEntry } from "@/types";
import { getAccountInfo } from "@services/tauri";
import type { ThreadAction } from "./useThreadsReducer";
import { normalizeAccountSnapshot } from "@app/utils/accountSnapshot";

type UseThreadAccountInfoOptions = {
  activeWorkspaceId: string | null;
  activeWorkspaceConnected?: boolean;
  dispatch: React.Dispatch<ThreadAction>;
  onDebug?: (entry: DebugEntry) => void;
};

export function useThreadAccountInfo({
  activeWorkspaceId,
  activeWorkspaceConnected,
  dispatch,
  onDebug,
}: UseThreadAccountInfoOptions) {
  const refreshAccountInfo = useCallback(
    async (workspaceId?: string) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-client-account-read`,
        timestamp: Date.now(),
        source: "client",
        label: "account/read",
        payload: { workspaceId: targetId },
      });
      try {
        const response = await getAccountInfo(targetId);
        onDebug?.({
          id: `${Date.now()}-server-account-read`,
          timestamp: Date.now(),
          source: "server",
          label: "account/read response",
          payload: response,
        });
        dispatch({
          type: "setAccountInfo",
          workspaceId: targetId,
          account: normalizeAccountSnapshot(response),
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-account-read-error`,
          timestamp: Date.now(),
          source: "error",
          label: "account/read error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeWorkspaceId, dispatch, onDebug],
  );

  useEffect(() => {
    if (activeWorkspaceConnected && activeWorkspaceId) {
      void refreshAccountInfo(activeWorkspaceId);
    }
  }, [activeWorkspaceConnected, activeWorkspaceId, refreshAccountInfo]);

  return { refreshAccountInfo };
}
