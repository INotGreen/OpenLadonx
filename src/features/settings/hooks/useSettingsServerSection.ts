import { useState } from "react";
import type { AppSettings } from "@/types";
import { listWorkspaces } from "@services/tauri";
import { isMobilePlatform } from "@utils/platformPaths";
import {
  buildRelayHostUrl,
  resolveRelayClientUrl,
  resolveRelayHostUrlCandidate,
} from "../utils/relay";
import { getRelayHostUrl } from "@services/runtimeDefaults";

type UseSettingsServerSectionArgs = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onMobileConnectSuccess?: () => Promise<void> | void;
};

export type SettingsServerSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  isMobilePlatform: boolean;
  mobileConnectBusy: boolean;
  mobileConnectStatusText: string | null;
  mobileConnectStatusError: boolean;
  onMobileConnectTest: () => void;
  desktopConnectBusy: boolean;
  desktopConnectStatusText: string | null;
  desktopConnectStatusError: boolean;
  onDesktopConnectTest: () => void;
};

export const useSettingsServerSection = ({
  appSettings,
  onUpdateAppSettings,
  onMobileConnectSuccess,
}: UseSettingsServerSectionArgs): SettingsServerSectionProps => {
  const [mobileConnectBusy, setMobileConnectBusy] = useState(false);
  const [mobileConnectStatusText, setMobileConnectStatusText] = useState<string | null>(null);
  const [mobileConnectStatusError, setMobileConnectStatusError] = useState(false);
  const [desktopConnectBusy, setDesktopConnectBusy] = useState(false);
  const [desktopConnectStatusText, setDesktopConnectStatusText] = useState<string | null>(null);
  const [desktopConnectStatusError, setDesktopConnectStatusError] = useState(false);
  const mobilePlatform = isMobilePlatform();

  const handleMobileConnectTest = () => {
    void (async () => {
      const websocketUrl = appSettings.remoteBackendWebSocketUrl?.trim();
      const relayHostUrl = resolveRelayHostUrlCandidate(
        websocketUrl,
        appSettings.codexBaseUrl,
        await getRelayHostUrl(),
      );
      const token = appSettings.remoteBackendToken?.trim();

      if (!token) {
        setMobileConnectStatusError(true);
        setMobileConnectStatusText("Authentication token is required.");
        return;
      }

      setMobileConnectBusy(true);
      setMobileConnectStatusText(null);
      setMobileConnectStatusError(false);
      try {
        const resolvedClientUrl = await resolveRelayClientUrl(relayHostUrl, token);
        await onUpdateAppSettings(
          mobilePlatform
            ? {
                ...appSettings,
                backendMode: "remote",
                remoteBackendProvider: "websocket",
                remoteBackendWebSocketUrl: resolvedClientUrl,
                remoteBackendToken: token,
              }
            : {
                ...appSettings,
                backendMode: "local",
                remoteBackendProvider: "websocket",
                remoteBackendWebSocketUrl: relayHostUrl,
                remoteBackendToken: token,
              },
        );

        // Test connection by listing workspaces
        await listWorkspaces();

        const workspaces = await listWorkspaces();
        const workspaceCount = workspaces.length;
        const workspaceWord = workspaceCount === 1 ? "workspace" : "workspaces";
        setMobileConnectStatusText(
          `Connected. ${workspaceCount} ${workspaceWord} reachable on the remote backend.`,
        );
        await onMobileConnectSuccess?.();
      } catch (error) {
        setMobileConnectStatusError(true);
        setMobileConnectStatusText(
          error instanceof Error ? error.message : "Unable to connect to remote backend.",
        );
      } finally {
        setMobileConnectBusy(false);
      }
    })();
  };

  const handleDesktopConnectTest = () => {
    void (async () => {
      const websocketUrl = appSettings.remoteBackendWebSocketUrl?.trim();
      const relayHostUrl = resolveRelayHostUrlCandidate(
        websocketUrl,
        appSettings.codexBaseUrl,
        await getRelayHostUrl(),
      );
      const token = appSettings.remoteBackendToken?.trim();

      if (!token) {
        setDesktopConnectStatusError(true);
        setDesktopConnectStatusText("Authentication token is required.");
        return;
      }

      setDesktopConnectBusy(true);
      setDesktopConnectStatusText(null);
      setDesktopConnectStatusError(false);
      try {
        const ws = new WebSocket(buildRelayHostUrl(relayHostUrl, token));

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("Connection timeout"));
          }, 10000);

          ws.onopen = () => {
            clearTimeout(timeout);
            setDesktopConnectStatusText(
              "Successfully connected to WebSocket relay server.",
            );
            ws.close();
            resolve();
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket connection failed"));
          };

          ws.onclose = () => {
            clearTimeout(timeout);
          };
        });
      } catch (error) {
        setDesktopConnectStatusError(true);
        setDesktopConnectStatusText(
          error instanceof Error ? error.message : "Unable to connect to relay server.",
        );
      } finally {
        setDesktopConnectBusy(false);
      }
    })();
  };

  return {
    appSettings,
    onUpdateAppSettings,
    isMobilePlatform: mobilePlatform,
    mobileConnectBusy,
    mobileConnectStatusText,
    mobileConnectStatusError,
    onMobileConnectTest: handleMobileConnectTest,
    desktopConnectBusy,
    desktopConnectStatusText,
    desktopConnectStatusError,
    onDesktopConnectTest: handleDesktopConnectTest,
  };
};
