import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  AppSettings,
  CodexDoctorResult,
  CodexUpdateResult,
  CustomApiConfig,
} from "@/types";
import { useGlobalAgentsMd } from "./useGlobalAgentsMd";
import { useGlobalCodexConfigToml } from "./useGlobalCodexConfigToml";
import { buildEditorContentMeta } from "@settings/components/settingsViewHelpers";
import {
  testLadonxApiKey,
  writeCodexBaseUrl as writeCodexBaseUrlToConfig,
  revealCodexConfig as getCodexConfigPath,
  readCodexBaseUrl,
  applyCustomResponseApi,
  applyCustomMessagesApi,
  applyDefaultApiCredentials,
} from "@/services/tauri";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

type UseSettingsCodexSectionArgs = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onPluginsChanged?: () => void | Promise<void>;
  onRunDoctor: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexDoctorResult>;
  onRunCodexUpdate?: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexUpdateResult>;
};

export type SettingsCodexSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  codexApiKeyDraft: string;
  codexBaseUrlDraft: string;
  doctorState: {
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  };
  codexUpdateState: {
    status: "idle" | "running" | "done";
    result: CodexUpdateResult | null;
  };
  displayedGlobalConfigPath: string;
  apiKeysError: string | null;
  apiSourceMode: "default" | "custom";
  customResponseApi: CustomApiConfig | null;
  customMessagesApi: CustomApiConfig | null;
  onSelectApiSourceMode: (mode: "default" | "custom") => Promise<void>;
  onSaveCustomResponseApi: (config: CustomApiConfig) => Promise<void>;
  onSaveCustomMessagesApi: (config: CustomApiConfig) => Promise<void>;
  onApplyCustomApi: (protocol: "response" | "messages", config: CustomApiConfig) => Promise<void>;
  globalAgentsMeta: string;
  globalAgentsPath: string;
  globalAgentsError: string | null;
  globalAgentsContent: string;
  globalAgentsLoading: boolean;
  globalAgentsRefreshDisabled: boolean;
  globalAgentsSaveDisabled: boolean;
  globalAgentsSaveLabel: string;
  globalConfigMeta: string;
  globalConfigPath: string;
  globalConfigError: string | null;
  globalConfigContent: string;
  globalConfigLoading: boolean;
  globalConfigRefreshDisabled: boolean;
  globalConfigSaveDisabled: boolean;
  globalConfigSaveLabel: string;
  onSetCodexApiKeyDraft: Dispatch<SetStateAction<string>>;
  onSetCodexBaseUrlDraft: Dispatch<SetStateAction<string>>;
  onSetGlobalAgentsContent: (value: string) => void;
  onSetGlobalConfigContent: (value: string) => void;
  onSaveCodexSettings: () => Promise<void>;
  onRunDoctor: () => Promise<void>;
  onRunCodexUpdate: () => Promise<void>;
  onRefreshGlobalAgents: () => void;
  onSaveGlobalAgents: () => void;
  onRefreshGlobalConfig: () => void;
  onSaveGlobalConfig: () => void;
  onSaveSettings: () => Promise<void>;
  onOpenConfigFile: () => void;
  onTestApiKey: (request: {
    baseUrl: string;
    apiKey: string;
    apiType?: string;
    model?: string;
  }) => Promise<unknown>;
  isSaving: boolean;
};

export const useSettingsCodexSection = ({
  appSettings,
  onUpdateAppSettings,
  onPluginsChanged,
  onRunDoctor,
  onRunCodexUpdate,
}: UseSettingsCodexSectionArgs): SettingsCodexSectionProps => {
  const [codexApiKeyDraft, setCodexApiKeyDraft] = useState(appSettings.codexApiKey ?? "");
  const [codexBaseUrlDraft, setCodexBaseUrlDraft] = useState(appSettings.codexBaseUrl ?? "");
  const [doctorState, setDoctorState] = useState<{
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  }>({ status: "idle", result: null });
  const [codexUpdateState, setCodexUpdateState] = useState<{
    status: "idle" | "running" | "done";
    result: CodexUpdateResult | null;
  }>({ status: "idle", result: null });
  const [apiKeysError, setApiKeysError] = useState<string | null>(null);

  const {
    content: globalAgentsContent,
    exists: globalAgentsExists,
    truncated: globalAgentsTruncated,
    path: globalAgentsPath,
    isLoading: globalAgentsLoading,
    isSaving: globalAgentsSaving,
    error: globalAgentsError,
    isDirty: globalAgentsDirty,
    setContent: setGlobalAgentsContent,
    refresh: refreshGlobalAgents,
    save: saveGlobalAgents,
  } = useGlobalAgentsMd();

  const {
    content: globalConfigContent,
    exists: globalConfigExists,
    truncated: globalConfigTruncated,
    path: globalConfigPath,
    isLoading: globalConfigLoading,
    isSaving: globalConfigSaving,
    error: globalConfigError,
    isDirty: globalConfigDirty,
    setContent: setGlobalConfigContent,
    refresh: refreshGlobalConfig,
    save: saveGlobalConfig,
  } = useGlobalCodexConfigToml(onPluginsChanged);

  const globalAgentsEditorMeta = buildEditorContentMeta({
    isLoading: globalAgentsLoading,
    isSaving: globalAgentsSaving,
    exists: globalAgentsExists,
    truncated: globalAgentsTruncated,
    isDirty: globalAgentsDirty,
  });

  const globalConfigEditorMeta = buildEditorContentMeta({
    isLoading: globalConfigLoading,
    isSaving: globalConfigSaving,
    exists: globalConfigExists,
    truncated: globalConfigTruncated,
    isDirty: globalConfigDirty,
  });

  useEffect(() => {
    setCodexApiKeyDraft(appSettings.codexApiKey ?? "");
  }, [appSettings.codexApiKey]);

  useEffect(() => {
    setCodexBaseUrlDraft(appSettings.codexBaseUrl ?? "");
  }, [appSettings.codexBaseUrl]);

  // Load base_url from config.toml on mount
  useEffect(() => {
    const loadBaseUrlFromConfig = async () => {
      try {
        const baseUrl = await readCodexBaseUrl();
        if (baseUrl) {
          setCodexBaseUrlDraft(baseUrl);
        }
      } catch (error) {
        console.error("Failed to load base_url from config:", error);
      }
    };
    void loadBaseUrlFromConfig();
  }, []);

  const handleRunDoctor = async () => {
    setDoctorState({ status: "running", result: null });
    try {
      const result = await onRunDoctor(null, null);
      setDoctorState({ status: "done", result });
    } catch (error) {
      setDoctorState({
        status: "done",
        result: {
          ok: false,
          codexBin: null,
          version: null,
          appServerOk: false,
          details: error instanceof Error ? error.message : String(error),
          path: null,
          nodeOk: false,
          nodeVersion: null,
          nodeDetails: null,
        },
      });
    }
  };

  const handleRunCodexUpdate = async () => {
    setCodexUpdateState({ status: "running", result: null });
    try {
      if (!onRunCodexUpdate) {
        setCodexUpdateState({
          status: "done",
          result: {
            ok: false,
            method: "unknown",
            package: null,
            beforeVersion: null,
            afterVersion: null,
            upgraded: false,
            output: null,
            details: "Codex updates are not available in this build.",
          },
        });
        return;
      }

      const result = await onRunCodexUpdate(null, null);
      setCodexUpdateState({ status: "done", result });
    } catch (error) {
      setCodexUpdateState({
        status: "done",
        result: {
          ok: false,
          method: "unknown",
          package: null,
          beforeVersion: null,
          afterVersion: null,
          upgraded: false,
          output: null,
          details: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const [isSaving, setIsSaving] = useState(false);

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      // Save API Key and Base URL to local app settings
      const nextCodexApiKey = codexApiKeyDraft.trim() ? codexApiKeyDraft.trim() : null;
      const nextCodexBaseUrl = codexBaseUrlDraft.trim() ? codexBaseUrlDraft.trim() : null;
      await onUpdateAppSettings({
        ...appSettings,
        codexApiKey: nextCodexApiKey,
        codexBaseUrl: nextCodexBaseUrl,
      });

      // Save base URL to config.toml
      await writeCodexBaseUrlToConfig(nextCodexBaseUrl);
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCodexSettings = async () => {
    await handleSaveSettings();
  };

  const handleOpenConfigFile = async () => {
    try {
      const configPath = await getCodexConfigPath();
      await revealItemInDir(configPath);
    } catch (error) {
      console.error("Failed to open config file:", error);
    }
  };

  const handleTestApiKey = async (request: {
    baseUrl: string;
    apiKey: string;
    apiType?: string;
    model?: string;
  }) => {
    return testLadonxApiKey(request);
  };

  const handleSelectApiSourceMode = async (mode: "default" | "custom") => {
    setApiKeysError(null);
    try {
      await onUpdateAppSettings({ ...appSettings, apiSourceMode: mode });
      if (mode === "custom") {
        const codexApi = appSettings.customResponseApi;
        if (codexApi && codexApi.baseUrl.trim() && codexApi.apiKey.trim()) {
          await applyCustomResponseApi(codexApi.baseUrl, codexApi.apiKey);
        }
        const messagesApi = appSettings.customMessagesApi;
        if (messagesApi && messagesApi.baseUrl.trim() && messagesApi.apiKey.trim()) {
          await applyCustomMessagesApi(messagesApi.baseUrl, messagesApi.apiKey);
        }
      } else {
        await applyDefaultApiCredentials();
      }
    } catch (error) {
      setApiKeysError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSaveCustomResponseApi = async (config: CustomApiConfig) => {
    setApiKeysError(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        apiSourceMode: "custom",
        customResponseApi: config,
      });
      await applyCustomResponseApi(config.baseUrl, config.apiKey);
    } catch (error) {
      setApiKeysError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const handleSaveCustomMessagesApi = async (config: CustomApiConfig) => {
    setApiKeysError(null);
    try {
      await onUpdateAppSettings({ ...appSettings, apiSourceMode: "custom", customMessagesApi: config });
      await applyCustomMessagesApi(config.baseUrl, config.apiKey);
    } catch (error) {
      setApiKeysError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const handleApplyCustomApi = async (protocol: "response" | "messages", config: CustomApiConfig) => {
    setApiKeysError(null);
    try {
      await onUpdateAppSettings({ ...appSettings, apiSourceMode: "custom" });
      if (protocol === "response") {
        await applyCustomResponseApi(config.baseUrl, config.apiKey);
        return;
      }
      await applyCustomMessagesApi(config.baseUrl, config.apiKey);
    } catch (error) {
      setApiKeysError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  return {
    appSettings,
    onUpdateAppSettings,
    codexApiKeyDraft,
    codexBaseUrlDraft,
    doctorState,
    codexUpdateState,
    displayedGlobalConfigPath: globalConfigPath.trim() || "cli/config.toml",
    apiKeysError,
    apiSourceMode: appSettings.apiSourceMode,
    customResponseApi: appSettings.customResponseApi,
    customMessagesApi: appSettings.customMessagesApi,
    onSelectApiSourceMode: handleSelectApiSourceMode,
    onSaveCustomResponseApi: handleSaveCustomResponseApi,
    onSaveCustomMessagesApi: handleSaveCustomMessagesApi,
    onApplyCustomApi: handleApplyCustomApi,
    // Global config props (passed to agents section)
    globalAgentsMeta: globalAgentsEditorMeta.meta,
    globalAgentsPath,
    globalAgentsError,
    globalAgentsContent,
    globalAgentsLoading,
    globalAgentsRefreshDisabled: globalAgentsEditorMeta.refreshDisabled,
    globalAgentsSaveDisabled: globalAgentsEditorMeta.saveDisabled,
    globalAgentsSaveLabel: globalAgentsEditorMeta.saveLabel,
    globalConfigMeta: globalConfigEditorMeta.meta,
    globalConfigPath,
    globalConfigError,
    globalConfigContent,
    globalConfigLoading,
    globalConfigRefreshDisabled: globalConfigEditorMeta.refreshDisabled,
    globalConfigSaveDisabled: globalConfigEditorMeta.saveDisabled,
    globalConfigSaveLabel: globalConfigEditorMeta.saveLabel,
    onSetCodexApiKeyDraft: setCodexApiKeyDraft,
    onSetCodexBaseUrlDraft: setCodexBaseUrlDraft,
    onSetGlobalAgentsContent: setGlobalAgentsContent,
    onSetGlobalConfigContent: setGlobalConfigContent,
    onSaveCodexSettings: handleSaveCodexSettings,
    onRunDoctor: handleRunDoctor,
    onRunCodexUpdate: handleRunCodexUpdate,
    onRefreshGlobalAgents: () => {
      void refreshGlobalAgents();
    },
    onSaveGlobalAgents: () => {
      void saveGlobalAgents();
    },
    onRefreshGlobalConfig: () => {
      void refreshGlobalConfig();
    },
    onSaveGlobalConfig: () => {
      void saveGlobalConfig();
    },
    onSaveSettings: handleSaveSettings,
    onOpenConfigFile: handleOpenConfigFile,
    onTestApiKey: handleTestApiKey,
    isSaving,
  };
};
