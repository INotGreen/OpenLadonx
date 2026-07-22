import { useCallback, useEffect, useMemo, useState } from "react";
import { listWorkspaces } from "../../../services/tauri";
import type { AppSettings } from "../../../types";
import { isMobilePlatform } from "../../../utils/platformPaths";
import type { MobileServerSetupWizardProps } from "../components/MobileServerSetupWizard";

const CONNECTIVITY_TIMEOUT_MS = 10000;

type UseMobileServerSetupParams = {
  appSettings: AppSettings;
  appSettingsLoading: boolean;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
  refreshWorkspaces: () => Promise<unknown>;
};

type UseMobileServerSetupResult = {
  isMobileRuntime: boolean;
  showMobileSetupWizard: boolean;
  mobileSetupWizardProps: MobileServerSetupWizardProps;
  handleMobileConnectSuccess: () => Promise<void>;
};

function isRemoteServerConfigured(settings: AppSettings): boolean {
  return (
    Boolean(settings.remoteBackendToken?.trim()) &&
    Boolean(settings.remoteBackendHost?.trim())
  );
}

function defaultMobileSetupMessage(): string {
  return "Enter your desktop backend host and token, then run Connect & Test.";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function markActiveRemoteBackendConnected(settings: AppSettings, connectedAtMs: number): AppSettings {
  const existingBackends: AppSettings["remoteBackends"] =
    settings.remoteBackends.length > 0
      ? [...settings.remoteBackends]
      : [
          {
            id: settings.activeRemoteBackendId ?? "remote-default",
            name: "Primary remote",
            provider: settings.remoteBackendWebSocketUrl?.trim() ? "websocket" : "tcp",
            host: settings.remoteBackendHost,
            token: settings.remoteBackendToken,
            lastConnectedAtMs: null,
          },
        ];
  const activeIndexById =
    settings.activeRemoteBackendId == null
      ? -1
      : existingBackends.findIndex((entry) => entry.id === settings.activeRemoteBackendId);
  const activeIndex = activeIndexById >= 0 ? activeIndexById : 0;
  const active = existingBackends[activeIndex];
  existingBackends[activeIndex] = {
    ...active,
    token: settings.remoteBackendToken,
    lastConnectedAtMs: connectedAtMs,
  };
  return {
    ...settings,
    remoteBackends: existingBackends,
    activeRemoteBackendId: existingBackends[activeIndex]?.id ?? settings.activeRemoteBackendId,
  };
}

export function useMobileServerSetup({
  appSettings,
  appSettingsLoading,
  queueSaveSettings,
  refreshWorkspaces,
}: UseMobileServerSetupParams): UseMobileServerSetupResult {
  const isMobileRuntime = useMemo(() => isMobilePlatform(), []);

  const [remoteBackendHostDraft, setRemoteBackendHostDraft] = useState(
    appSettings.remoteBackendHost ?? "",
  );
  const [remoteTokenDraft, setRemoteTokenDraft] = useState(appSettings.remoteBackendToken ?? "");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [mobileServerReady, setMobileServerReady] = useState(!isMobileRuntime);
  const [setupWizardDismissed, setSetupWizardDismissed] = useState(false);

  useEffect(() => {
    if (!isMobileRuntime) {
      return;
    }
    setRemoteBackendHostDraft(appSettings.remoteBackendHost ?? "");
    setRemoteTokenDraft(appSettings.remoteBackendToken ?? "");
  }, [
    appSettings.remoteBackendHost,
    appSettings.remoteBackendToken,
    isMobileRuntime,
  ]);

  const runConnectivityCheck = useCallback(
    async (options?: { announceSuccess?: boolean }) => {
      if (!isMobileRuntime) {
        return true;
      }
      try {
        const entries = await withTimeout(
          listWorkspaces(),
          CONNECTIVITY_TIMEOUT_MS,
          "Timed out while checking remote backend. Make sure the desktop host bridge is connected.",
        );
        try {
          await withTimeout(
            Promise.resolve(refreshWorkspaces()).then(() => undefined),
            CONNECTIVITY_TIMEOUT_MS,
            "Timed out while refreshing remote workspaces.",
          );
        } catch {
          // Connectivity is confirmed by listWorkspaces; refresh is best-effort.
        }
        setMobileServerReady(true);
        setStatusError(false);
        if (options?.announceSuccess) {
          const count = entries.length;
          const workspaceWord = count === 1 ? "workspace" : "workspaces";
          setStatusMessage(`Connected. ${count} ${workspaceWord} available from your desktop backend.`);
        } else {
          setStatusMessage(null);
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to reach remote backend.";
        setMobileServerReady(false);
        setStatusError(true);
        setStatusMessage(message);
        return false;
      }
    },
    [isMobileRuntime, refreshWorkspaces],
  );

  const onConnectTest = useCallback(() => {
    void (async () => {
      if (!isMobileRuntime || busy) {
        return;
      }

      const nextHost = remoteBackendHostDraft.trim();
      const nextToken = remoteTokenDraft.trim() ? remoteTokenDraft.trim() : null;

      if (!nextHost || !nextToken) {
        setMobileServerReady(false);
        setStatusError(true);
        setStatusMessage(defaultMobileSetupMessage());
        return;
      }

      setBusy(true);
      setSetupWizardDismissed(false);
      setStatusError(false);
      setStatusMessage(null);
      try {
        const saved = await queueSaveSettings({
          ...appSettings,
          backendMode: "remote",
          remoteBackendProvider: "tcp",
          remoteBackendHost: nextHost,
          remoteBackendToken: nextToken,
          remoteBackendWebSocketUrl: null,
        });
        const connected = await runConnectivityCheck({ announceSuccess: true });
        if (connected) {
          await queueSaveSettings(markActiveRemoteBackendConnected(saved, Date.now()));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save remote backend settings.";
        setMobileServerReady(false);
        setStatusError(true);
        setStatusMessage(message);
      } finally {
        setBusy(false);
      }
    })();
  }, [
    appSettings,
    busy,
    isMobileRuntime,
    queueSaveSettings,
    remoteBackendHostDraft,
    remoteTokenDraft,
    runConnectivityCheck,
  ]);

  useEffect(() => {
    if (!isMobileRuntime || appSettingsLoading || busy) {
      return;
    }
    if (!isRemoteServerConfigured(appSettings)) {
      setMobileServerReady(false);
      setChecking(false);
      setStatusError(true);
      setStatusMessage(defaultMobileSetupMessage());
      return;
    }

    let active = true;
    setChecking(true);
    setStatusMessage(null);
    setStatusError(false);

    void (async () => {
      const ok = await runConnectivityCheck();
      if (active && !ok) {
        setStatusMessage((previous) => previous ?? "Unable to connect to remote backend.");
      }
      if (active) {
        setChecking(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    appSettings,
    appSettingsLoading,
    busy,
    isMobileRuntime,
    runConnectivityCheck,
  ]);

  const handleMobileConnectSuccess = useCallback(async () => {
    if (!isMobileRuntime) {
      return;
    }
    setStatusError(false);
    setStatusMessage(null);
    setMobileServerReady(true);
    setSetupWizardDismissed(false);
    try {
      await refreshWorkspaces();
    } catch {
      // Keep successful connectivity result even if local refresh fails.
    }
  }, [isMobileRuntime, refreshWorkspaces]);

  return {
    isMobileRuntime,
    showMobileSetupWizard:
      isMobileRuntime && !appSettingsLoading && !mobileServerReady && !setupWizardDismissed,
    mobileSetupWizardProps: {
      remoteBackendHostDraft,
      remoteTokenDraft,
      busy,
      checking,
      statusMessage,
      statusError,
      onClose: () => {
        setSetupWizardDismissed(true);
      },
      onRemoteBackendHostChange: setRemoteBackendHostDraft,
      onRemoteTokenChange: setRemoteTokenDraft,
      onConnectTest,
    },
    handleMobileConnectSuccess,
  };
}
