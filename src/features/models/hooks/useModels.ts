import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEntry, ModelOption, WorkspaceInfo } from "../../../types";
import { getConfigModel } from "../../../services/tauri";
import {
  REASONING_EFFORT_OPTIONS,
  normalizeReasoningEffortOption,
} from "@/utils/reasoningEffort";
import { fetchRemoteModelList } from "../utils/fetchRemoteModelList";

type UseModelsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
  preferredModelId?: string | null;
  preferredEffort?: string | null;
  selectionKey?: string | null;
  /** 由本地自定义配置生成的模型列表；非空时跳过后端拉取。 */
  customModels?: ModelOption[] | null;
  /** 登录态下允许通过 API Key 请求后端模型列表；未登录时关闭远程拉取。 */
  remoteModelsEnabled?: boolean;
};

const findModelByIdOrModel = (
  models: ModelOption[],
  idOrModel: string | null,
): ModelOption | null => {
  if (!idOrModel) {
    return null;
  }
  return (
    models.find((model) => model.id === idOrModel) ??
    models.find((model) => model.model === idOrModel) ??
    null
  );
};

const pickDefaultModel = (models: ModelOption[], configModel: string | null) =>
  findModelByIdOrModel(models, configModel) ??
  models.find((model) => model.isDefault) ??
  models[0] ??
  null;

export function useModels({
  activeWorkspace,
  onDebug,
  preferredModelId = null,
  preferredEffort = null,
  selectionKey = null,
  customModels = null,
  remoteModelsEnabled = true,
}: UseModelsOptions) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [configModel, setConfigModel] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffortState] = useState<string | null>(null);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const hasUserSelectedModel = useRef(false);
  const hasUserSelectedEffort = useRef(false);
  const lastWorkspaceId = useRef<string | null>(null);
  const lastSelectionKey = useRef<string | null>(null);
  const lastCustomModelsRef = useRef<ModelOption[] | null | undefined>(undefined);
  const lastRemoteModelsEnabledRef = useRef<boolean | undefined>(undefined);

  const workspaceId = activeWorkspace?.id ?? null;
  const workspaceSource = activeWorkspace?.source ?? null;
  const workspaceModelKey = workspaceId && workspaceSource
    ? `${workspaceId}:${workspaceSource}`
    : null;
  const isConnected = Boolean(activeWorkspace?.connected);

  useEffect(() => {
    if (selectionKey === lastSelectionKey.current) {
      return;
    }
    lastSelectionKey.current = selectionKey;
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
  }, [selectionKey]);

  useEffect(() => {
    if (workspaceModelKey === lastWorkspaceId.current) {
      return;
    }
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    lastWorkspaceId.current = workspaceModelKey;
    setConfigModel(null);
  }, [workspaceModelKey]);

  useEffect(() => {
    if (selectedEffort === null) {
      return;
    }
    if (selectedEffort.trim().length > 0) {
      return;
    }
    hasUserSelectedEffort.current = false;
    setSelectedEffortState(null);
  }, [selectedEffort]);

  const setSelectedModelId = useCallback((next: string | null) => {
    hasUserSelectedModel.current = true;
    setSelectedModelIdState(next);
  }, []);

  const setSelectedEffort = useCallback((next: string | null) => {
    hasUserSelectedEffort.current = true;
    setSelectedEffortState(next);
  }, []);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const reasoningSupported = useMemo(() => {
    return selectedModel !== null;
  }, [selectedModel]);

  const reasoningOptions = useMemo(() => {
    return selectedModel ? [...REASONING_EFFORT_OPTIONS] : [];
  }, [selectedModel]);

  const resolveEffort = useCallback(
    (model: ModelOption, preferCurrent: boolean) => {
      const currentEffort = normalizeReasoningEffortOption(selectedEffort);
      if (preferCurrent && currentEffort) {
        return currentEffort;
      }
      const preferred = normalizeReasoningEffortOption(preferredEffort);
      if (preferred) {
        return preferred;
      }
      return (
        normalizeReasoningEffortOption(model.defaultReasoningEffort) ?? "medium"
      );
    },
    [preferredEffort, selectedEffort],
  );

  const refreshModels = useCallback(async () => {
    if (!workspaceId || !workspaceSource || !isConnected) {
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;

    // 自定义 API 模式：直接使用本地配置的模型列表，跳过后端拉取。
    if (customModels && customModels.length > 0) {
      setConfigModel(null);
      setModels(customModels);
      lastFetchedWorkspaceId.current = workspaceModelKey;
      const defaultModel = pickDefaultModel(customModels, null);
      const existingSelection = findModelByIdOrModel(customModels, selectedModelId);
      if (selectedModelId && !existingSelection) {
        hasUserSelectedModel.current = false;
      }
      const preferredSelection = findModelByIdOrModel(customModels, preferredModelId);
      const shouldKeepExisting =
        hasUserSelectedModel.current && existingSelection !== null;
      const nextSelection =
        (shouldKeepExisting ? existingSelection : null) ??
        preferredSelection ??
        defaultModel ??
        existingSelection;
      if (nextSelection) {
        if (nextSelection.id !== selectedModelId) {
          setSelectedModelIdState(nextSelection.id);
        }
        const nextEffort = resolveEffort(
          nextSelection,
          hasUserSelectedEffort.current,
        );
        if (nextEffort !== selectedEffort) {
          setSelectedEffortState(nextEffort);
        }
      }
      inFlight.current = false;
      return;
    }

    if (!remoteModelsEnabled) {
      setConfigModel(null);
      setModels([]);
      setSelectedModelIdState(null);
      setSelectedEffortState(null);
      lastFetchedWorkspaceId.current = workspaceModelKey;
      inFlight.current = false;
      return;
    }

    onDebug?.({
      id: `${Date.now()}-client-model-list`,
      timestamp: Date.now(),
      source: "client",
      label: "model/list",
      payload: {
        workspaceId,
        type: workspaceSource === "claude_code" ? "message" : "response",
      },
    });
    try {
      const [modelListResult, configModelResult] = await Promise.allSettled([
        fetchRemoteModelList(
          workspaceSource === "claude_code" ? "anthropic" : "openai",
          workspaceSource === "claude_code" ? "message" : "response",
          { preferLadonxBaseUrl: true },
        ),
        getConfigModel(workspaceId),
      ]);
      const configModelFromConfig =
        configModelResult.status === "fulfilled"
          ? configModelResult.value
          : null;
      if (configModelResult.status === "rejected") {
        onDebug?.({
          id: `${Date.now()}-client-config-model-error`,
          timestamp: Date.now(),
          source: "error",
          label: "config/model error",
          payload:
            configModelResult.reason instanceof Error
              ? configModelResult.reason.message
              : String(configModelResult.reason),
        });
      }
      const response =
        modelListResult.status === "fulfilled" ? modelListResult.value : null;
      if (modelListResult.status === "rejected") {
        onDebug?.({
          id: `${Date.now()}-client-model-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "model/list error",
          payload:
            modelListResult.reason instanceof Error
              ? modelListResult.reason.message
              : String(modelListResult.reason),
        });
      }
      onDebug?.({
        id: `${Date.now()}-server-model-list`,
        timestamp: Date.now(),
        source: "server",
        label: "model/list response",
        payload: response,
      });
      setConfigModel(configModelFromConfig);
      const data =
        modelListResult.status === "fulfilled" ? modelListResult.value : [];
      setModels(data);
      lastFetchedWorkspaceId.current = workspaceModelKey;
      const defaultModel = pickDefaultModel(data, configModelFromConfig);
      const existingSelection = findModelByIdOrModel(data, selectedModelId);
      if (selectedModelId && !existingSelection) {
        hasUserSelectedModel.current = false;
      }
      const preferredSelection = findModelByIdOrModel(data, preferredModelId);
      const shouldKeepExisting =
        hasUserSelectedModel.current && existingSelection !== null;
      const nextSelection =
        (shouldKeepExisting ? existingSelection : null) ??
        preferredSelection ??
        defaultModel ??
        existingSelection;
      if (nextSelection) {
        if (nextSelection.id !== selectedModelId) {
          setSelectedModelIdState(nextSelection.id);
        }
        const nextEffort = resolveEffort(
          nextSelection,
          hasUserSelectedEffort.current,
        );
        if (nextEffort !== selectedEffort) {
          setSelectedEffortState(nextEffort);
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [
    isConnected,
    onDebug,
    preferredModelId,
    selectedEffort,
    selectedModelId,
    resolveEffort,
    workspaceId,
    workspaceModelKey,
    workspaceSource,
    customModels,
    remoteModelsEnabled,
  ]);

  useEffect(() => {
    if (!workspaceModelKey || !isConnected) {
      return;
    }
    const customChanged = lastCustomModelsRef.current !== customModels;
    const remoteModelsEnabledChanged =
      lastRemoteModelsEnabledRef.current !== remoteModelsEnabled;
    if (
      !customChanged &&
      !remoteModelsEnabledChanged &&
      lastFetchedWorkspaceId.current === workspaceModelKey &&
      models.length > 0
    ) {
      return;
    }
    lastCustomModelsRef.current = customModels;
    lastRemoteModelsEnabledRef.current = remoteModelsEnabled;
    refreshModels();
  }, [
    isConnected,
    models.length,
    refreshModels,
    workspaceModelKey,
    customModels,
    remoteModelsEnabled,
  ]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    const currentEffort = normalizeReasoningEffortOption(selectedEffort);
    if (currentEffort) {
      return;
    }
    const nextEffort =
      normalizeReasoningEffortOption(selectedModel.defaultReasoningEffort) ??
      "medium";
    hasUserSelectedEffort.current = false;
    setSelectedEffortState(nextEffort);
  }, [selectedEffort, selectedModel]);

  useEffect(() => {
    if (!models.length) {
      return;
    }
    const preferredSelection = findModelByIdOrModel(models, preferredModelId);
    const defaultModel = pickDefaultModel(models, configModel);
    const existingSelection = findModelByIdOrModel(models, selectedModelId);
    if (selectedModelId && !existingSelection) {
      hasUserSelectedModel.current = false;
    }
    const shouldKeepUserSelection =
      hasUserSelectedModel.current && existingSelection !== null;
    if (shouldKeepUserSelection) {
      return;
    }
    const nextSelection =
      preferredSelection ?? defaultModel ?? existingSelection ?? null;
    if (!nextSelection) {
      return;
    }
    if (nextSelection.id !== selectedModelId) {
      setSelectedModelIdState(nextSelection.id);
    }
    const nextEffort = resolveEffort(nextSelection, hasUserSelectedEffort.current);
    if (nextEffort !== selectedEffort) {
      setSelectedEffortState(nextEffort);
    }
  }, [
    configModel,
    models,
    preferredModelId,
    selectedEffort,
    selectedModelId,
    resolveEffort,
  ]);

  return {
    models,
    selectedModel,
    reasoningSupported,
    selectedModelId,
    setSelectedModelId,
    reasoningOptions,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
  };
}
