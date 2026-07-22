import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "@/types";
import { getAppSettings, runCodexDoctor, updateAppSettings } from "@services/tauri";
import i18n from "@/i18n";
import { clampUiScale, UI_SCALE_DEFAULT } from "@utils/uiScale";
import { CHAT_SCROLLBACK_DEFAULT, normalizeChatHistoryScrollbackItems } from "@utils/chatScrollback";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  CODE_FONT_SIZE_DEFAULT,
  clampCodeFontSize,
  normalizeFontFamily,
} from "@utils/fonts";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
  OPEN_APP_STORAGE_KEY,
} from "@app/constants";
import { COMPOSER_PRESET_CONFIGS } from "../components/settingsViewConstants";
import { normalizeOpenAppTargets } from "@app/utils/openApp";
import { getDefaultInterruptShortcut, isMacPlatform } from "@utils/shortcuts";
import { isMobilePlatform } from "@utils/platformPaths";
import { DEFAULT_COMMIT_MESSAGE_PROMPT } from "@utils/commitMessagePrompt";
import { resolveRelayHostUrlCandidate } from "../utils/relay";
import { getRelayHostUrl, getRemoteBackendHost } from "@services/runtimeDefaults";

const allowedThemes = new Set(["system", "light", "dark", "dim"]);
const allowedPersonality = new Set(["friendly", "pragmatic"]);
const allowedFollowUpMessageBehavior = new Set(["queue", "steer"]);
const DEFAULT_REMOTE_BACKEND_ID = "remote-default";
const DEFAULT_REMOTE_BACKEND_NAME = "Primary remote";
const DEFAULT_REMOTE_PROVIDER: AppSettings["remoteBackendProvider"] = "tcp";

type RemoteBackendTarget = AppSettings["remoteBackends"][number];

function normalizeRemoteProvider(
  value: unknown,
  options?: { websocketUrl?: string | null | undefined },
): AppSettings["remoteBackendProvider"] {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "tcp" || normalized === "websocket") {
      return normalized;
    }
  }
  return options?.websocketUrl?.trim() ? "websocket" : "tcp";
}

function normalizeRemoteToken(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null;
}

function defaultRemoteBackendHostForPlatform(defaultRemoteBackendHost: string): string {
  return isMobilePlatform() ? "" : defaultRemoteBackendHost;
}

function normalizeRemoteHost(
  value: string | null | undefined,
  defaultRemoteBackendHost: string,
): string {
  return value?.trim()
    ? value.trim()
    : defaultRemoteBackendHostForPlatform(defaultRemoteBackendHost);
}

function normalizeRemoteName(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback;
}

function normalizeRemoteBackends(settings: AppSettings, defaultRemoteBackendHost: string): {
  remoteBackends: RemoteBackendTarget[];
  activeRemoteBackendId: string | null;
  remoteBackendProvider: AppSettings["remoteBackendProvider"];
  remoteBackendHost: string;
  remoteBackendToken: string | null;
} {
  const legacyProvider = normalizeRemoteProvider(settings.remoteBackendProvider, {
    websocketUrl: settings.remoteBackendWebSocketUrl,
  });
  const legacyHost = normalizeRemoteHost(
    settings.remoteBackendHost,
    defaultRemoteBackendHost,
  );
  const legacyToken = normalizeRemoteToken(settings.remoteBackendToken);
  const usedIds = new Set<string>();

  const normalized = (settings.remoteBackends ?? []).map((entry, index) => {
    const baseId = entry.id?.trim() || `remote-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return {
      id,
      name: normalizeRemoteName(entry.name, `Remote ${index + 1}`),
      provider: normalizeRemoteProvider(entry.provider, {
        websocketUrl: settings.remoteBackendWebSocketUrl,
      }),
      host: normalizeRemoteHost(entry.host, defaultRemoteBackendHost),
      token: normalizeRemoteToken(entry.token),
      lastConnectedAtMs:
        typeof entry.lastConnectedAtMs === "number" && Number.isFinite(entry.lastConnectedAtMs)
          ? entry.lastConnectedAtMs
          : null,
    };
  });

  if (normalized.length === 0) {
    const fallback: RemoteBackendTarget = {
      id: DEFAULT_REMOTE_BACKEND_ID,
      name: DEFAULT_REMOTE_BACKEND_NAME,
      provider: legacyProvider,
      host: legacyHost,
      token: legacyToken,
      lastConnectedAtMs: null,
    };
    return {
      remoteBackends: [fallback],
      activeRemoteBackendId: fallback.id,
      remoteBackendProvider: fallback.provider,
      remoteBackendHost: fallback.host,
      remoteBackendToken: fallback.token,
    };
  }

  const activeIndexById =
    settings.activeRemoteBackendId == null
      ? -1
      : normalized.findIndex((entry) => entry.id === settings.activeRemoteBackendId);
  const activeIndex = activeIndexById >= 0 ? activeIndexById : 0;
  const active = normalized[activeIndex];
  const syncedActive = {
    ...active,
    provider: legacyProvider,
    host: legacyHost,
    token: legacyToken,
  };
  const remoteBackends = [...normalized];
  remoteBackends[activeIndex] = syncedActive;
  return {
    remoteBackends,
    activeRemoteBackendId: syncedActive.id,
    remoteBackendProvider: syncedActive.provider,
    remoteBackendHost: syncedActive.host,
    remoteBackendToken: syncedActive.token,
  };
}

function buildDefaultSettings(defaultRemoteBackendHost: string): AppSettings {
  const isMac = isMacPlatform();
  const isMobile = isMobilePlatform();
  const defaultRemote: RemoteBackendTarget = {
    id: DEFAULT_REMOTE_BACKEND_ID,
    name: DEFAULT_REMOTE_BACKEND_NAME,
    provider: DEFAULT_REMOTE_PROVIDER,
    host: defaultRemoteBackendHostForPlatform(defaultRemoteBackendHost),
    token: null,
    lastConnectedAtMs: null,
  };
  return {
    codexBin: null,
    codexArgs: null,
    codexApiKey: null,
    codexBaseUrl: null,
    apiSourceMode: "default",
    customResponseApi: null,
    customMessagesApi: null,
    backendMode: isMobile ? "remote" : "local",
    remoteBackendProvider: defaultRemote.provider,
    remoteBackendHost: defaultRemote.host,
    remoteBackendToken: null,
    remoteBackendWebSocketUrl: null,
    remoteBackends: [defaultRemote],
    activeRemoteBackendId: defaultRemote.id,
    keepDaemonRunningAfterAppClose: false,
    defaultAccessMode: "current",
    reviewDeliveryMode: "inline",
    composerModelShortcut: isMac ? "cmd+shift+m" : "ctrl+shift+m",
    composerAccessShortcut: isMac ? "cmd+shift+a" : "ctrl+shift+a",
    composerReasoningShortcut: isMac ? "cmd+shift+r" : "ctrl+shift+r",
    composerCollaborationShortcut: "shift+tab",
    interruptShortcut: getDefaultInterruptShortcut(),
    newAgentShortcut: isMac ? "cmd+n" : "ctrl+n",
    newWorktreeAgentShortcut: isMac ? "cmd+shift+n" : "ctrl+shift+n",
    newCloneAgentShortcut: isMac ? "cmd+alt+n" : "ctrl+alt+n",
    archiveThreadShortcut: isMac ? "cmd+ctrl+a" : "ctrl+alt+a",
    toggleProjectsSidebarShortcut: isMac ? "cmd+shift+p" : "ctrl+shift+p",
    toggleGitSidebarShortcut: isMac ? "cmd+shift+g" : "ctrl+shift+g",
    branchSwitcherShortcut: isMac ? "cmd+b" : "ctrl+b",
    toggleDebugPanelShortcut: isMac ? "cmd+shift+d" : "ctrl+shift+d",
    toggleTerminalShortcut: isMac ? "cmd+shift+t" : "ctrl+shift+t",
    cycleAgentNextShortcut: isMac ? "cmd+ctrl+down" : "ctrl+alt+down",
    cycleAgentPrevShortcut: isMac ? "cmd+ctrl+up" : "ctrl+alt+up",
    cycleWorkspaceNextShortcut: isMac ? "cmd+shift+down" : "ctrl+alt+shift+down",
    cycleWorkspacePrevShortcut: isMac ? "cmd+shift+up" : "ctrl+alt+shift+up",
    lastComposerModelId: null,
    lastComposerReasoningEffort: null,
    uiScale: UI_SCALE_DEFAULT,
    theme: "dark",
    language: "zh", // 默认语言为中文
    usageShowRemaining: false,
    showMessageFilePath: true,
    chatHistoryScrollbackItems: CHAT_SCROLLBACK_DEFAULT,
    uiFontFamily: DEFAULT_UI_FONT_FAMILY,
    codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
    codeFontSize: CODE_FONT_SIZE_DEFAULT,
    notificationSoundsEnabled: true,
    systemNotificationsEnabled: true,
    subagentSystemNotificationsEnabled: true,
    splitChatDiffView: false,
    preloadGitDiffs: true,
    gitDiffIgnoreWhitespaceChanges: false,
    commitMessagePrompt: DEFAULT_COMMIT_MESSAGE_PROMPT,
    commitMessageModelId: null,
    collaborationModesEnabled: true,
    steerEnabled: true,
    followUpMessageBehavior: "queue",
    composerFollowUpHintEnabled: true,
    pauseQueuedMessagesWhenResponseRequired: true,
    unifiedExecEnabled: true,
    experimentalAppsEnabled: false,
    personality: "friendly",
    dictationEnabled: false,
    dictationModelId: "base",
    dictationPreferredLanguage: null,
    dictationHoldKey: "alt",
    composerEditorPreset: "smart",
    ...COMPOSER_PRESET_CONFIGS.smart,
    workspaceGroups: [],
    openAppTargets: DEFAULT_OPEN_APP_TARGETS,
    selectedOpenAppId: DEFAULT_OPEN_APP_ID,
    globalWorktreesFolder: null,
  };
}

function normalizeAppSettings(
  settings: AppSettings,
  defaults: { relayHostUrl: string; remoteBackendHost: string },
): AppSettings {
  const mobile = isMobilePlatform();
  const normalizedRelayHostUrl = resolveRelayHostUrlCandidate(
    settings.remoteBackendWebSocketUrl,
    settings.codexBaseUrl,
    defaults.relayHostUrl,
  );
  const normalizedBackendMode =
    !mobile &&
    settings.remoteBackendWebSocketUrl?.includes("/v1/api/ladonxrelay/client")
      ? "local"
      : settings.backendMode;
  const remoteBackendSettings = normalizeRemoteBackends(
    settings,
    defaults.remoteBackendHost,
  );
  const normalizedTargets =
    settings.openAppTargets && settings.openAppTargets.length
      ? normalizeOpenAppTargets(settings.openAppTargets)
      : DEFAULT_OPEN_APP_TARGETS;
  const storedOpenAppId =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(OPEN_APP_STORAGE_KEY);
  const hasPersistedSelection = normalizedTargets.some(
    (target) => target.id === settings.selectedOpenAppId,
  );
  const hasStoredSelection =
    !hasPersistedSelection &&
    storedOpenAppId !== null &&
    normalizedTargets.some((target) => target.id === storedOpenAppId);
  const selectedOpenAppId = hasPersistedSelection
    ? settings.selectedOpenAppId
    : hasStoredSelection
      ? storedOpenAppId
      : normalizedTargets[0]?.id ?? DEFAULT_OPEN_APP_ID;
  const commitMessagePrompt =
    settings.commitMessagePrompt && settings.commitMessagePrompt.trim().length > 0
      ? settings.commitMessagePrompt
      : DEFAULT_COMMIT_MESSAGE_PROMPT;
  const chatHistoryScrollbackItems = normalizeChatHistoryScrollbackItems(
    settings.chatHistoryScrollbackItems,
  );
  return {
    ...settings,
    ...remoteBackendSettings,
    backendMode: normalizedBackendMode,
    remoteBackendWebSocketUrl:
      !mobile && settings.remoteBackendWebSocketUrl?.trim()
        ? normalizedRelayHostUrl
        : settings.remoteBackendWebSocketUrl,
    codexBin: settings.codexBin?.trim() ? settings.codexBin.trim() : null,
    codexArgs: settings.codexArgs?.trim() ? settings.codexArgs.trim() : null,
    codexApiKey: settings.codexApiKey?.trim() ? settings.codexApiKey.trim() : null,
    uiScale: clampUiScale(settings.uiScale),
    theme: allowedThemes.has(settings.theme) ? settings.theme : "system",
    uiFontFamily: normalizeFontFamily(
      settings.uiFontFamily,
      DEFAULT_UI_FONT_FAMILY,
    ),
    codeFontFamily: normalizeFontFamily(
      settings.codeFontFamily,
      DEFAULT_CODE_FONT_FAMILY,
    ),
    codeFontSize: clampCodeFontSize(settings.codeFontSize),
    personality: allowedPersonality.has(settings.personality)
      ? settings.personality
      : "friendly",
    followUpMessageBehavior: allowedFollowUpMessageBehavior.has(
      settings.followUpMessageBehavior,
    )
      ? settings.followUpMessageBehavior
      : settings.steerEnabled
        ? "steer"
        : "queue",
    composerFollowUpHintEnabled:
      typeof settings.composerFollowUpHintEnabled === "boolean"
        ? settings.composerFollowUpHintEnabled
        : true,
    reviewDeliveryMode:
      settings.reviewDeliveryMode === "detached" ? "detached" : "inline",
    chatHistoryScrollbackItems,
    commitMessagePrompt,
    openAppTargets: normalizedTargets,
    selectedOpenAppId,
  };
}

export function useAppSettings() {
  const defaultSettings = useMemo(() => buildDefaultSettings(""), []);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [response, relayHostUrl, remoteBackendHost] = await Promise.all([
          getAppSettings(),
          getRelayHostUrl(),
          getRemoteBackendHost(),
        ]);
        const runtimeDefaults = { relayHostUrl, remoteBackendHost };
        const runtimeDefaultSettings = buildDefaultSettings(remoteBackendHost);
        if (active) {
          setSettings(
            normalizeAppSettings({
              ...runtimeDefaultSettings,
              ...response,
            }, runtimeDefaults),
          );
        }
      } catch {
        // Defaults stay in place if loading settings fails.
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [defaultSettings]);

  const saveSettings = useCallback(async (next: AppSettings) => {
    const [relayHostUrl, remoteBackendHost] = await Promise.all([
      getRelayHostUrl(),
      getRemoteBackendHost(),
    ]);
    const runtimeDefaults = { relayHostUrl, remoteBackendHost };
    const runtimeDefaultSettings = buildDefaultSettings(remoteBackendHost);
    const normalized = normalizeAppSettings(next, runtimeDefaults);
    const saved = await updateAppSettings(normalized);
    setSettings(
      normalizeAppSettings({
        ...runtimeDefaultSettings,
        ...saved,
      }, runtimeDefaults),
    );
    return saved;
  }, [defaultSettings]);

  const doctor = useCallback(
    async (codexBin: string | null, codexArgs: string | null) => {
      return runCodexDoctor(codexBin, codexArgs);
    },
    [],
  );

  const changeLanguage = useCallback(async (language: "en" | "zh") => {
    const updated = {
      ...settings,
      language
    };
    await saveSettings(updated);
    i18n.changeLanguage(language);
  }, [settings, saveSettings]);

  return {
    settings,
    setSettings,
    saveSettings,
    doctor,
    changeLanguage,
    isLoading,
  };
}
