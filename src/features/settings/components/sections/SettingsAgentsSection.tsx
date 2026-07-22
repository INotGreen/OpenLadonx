import { useEffect, useMemo, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AppSettings, ModelOption } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { FileEditorCard } from "@/features/shared/components/FileEditorCard";
import {
  MagicSparkleIcon,
  MagicSparkleLoaderIcon,
} from "@/features/shared/components/MagicSparkleIcon";
import type { SettingsAgentsSectionProps } from "@settings/hooks/useSettingsAgentsSection";
import { fileManagerName, openInFileManagerLabel } from "@utils/platformPaths";
import { formatReasoningEffortLabel } from "@/utils/reasoningEffort";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";

const FALLBACK_AGENT_MODELS: ModelOption[] = [
  {
    id: "gpt-5-codex",
    model: "gpt-5-codex",
    displayName: "gpt-5-codex",
    description: "Fallback model while workspace model list is unavailable.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "" },
      { reasoningEffort: "medium", description: "" },
      { reasoningEffort: "high", description: "" },
    ],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
];

const MIN_MAX_THREADS = 1;
const MAX_MAX_THREADS = 12;
const MIN_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 4;

export function SettingsAgentsSection({
  settings,
  isLoading,
  isUpdatingCore,
  creatingAgent,
  updatingAgentName,
  deletingAgentName,
  readingConfigAgentName,
  writingConfigAgentName,
  createDescriptionGenerating,
  editDescriptionGenerating,
  error,
  onRefresh,
  onSetMultiAgentEnabled,
  onSetMaxThreads,
  onSetMaxDepth,
  onCreateAgent,
  onUpdateAgent,
  onDeleteAgent,
  onReadAgentConfig,
  onWriteAgentConfig,
  onGenerateCreateDescription,
  onGenerateEditDescription,
  modelOptions,
  modelOptionsLoading,
  modelOptionsError,
  // Codex settings props
  appSettings,
  onUpdateAppSettings,
  globalAgentsMeta,
  globalAgentsPath,
  globalAgentsError,
  globalAgentsContent,
  globalAgentsLoading,
  globalAgentsRefreshDisabled,
  globalAgentsSaveDisabled,
  globalAgentsSaveLabel,
  globalConfigMeta,
  globalConfigPath,
  globalConfigError,
  globalConfigContent,
  globalConfigLoading,
  globalConfigRefreshDisabled,
  globalConfigSaveDisabled,
  globalConfigSaveLabel,
  onSetGlobalAgentsContent,
  onSetGlobalConfigContent,
  onRefreshGlobalAgents,
  onSaveGlobalAgents,
  onRefreshGlobalConfig,
  onSaveGlobalConfig,
}: SettingsAgentsSectionProps) {
  const { t } = useI18nSafe();
  const [openPathError, setOpenPathError] = useState<string | null>(null);
  const [maxThreadsDraft, setMaxThreadsDraft] = useState("6");
  const [maxDepthDraft, setMaxDepthDraft] = useState("1");

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createDeveloperInstructions, setCreateDeveloperInstructions] = useState("");
  const [createModel, setCreateModel] = useState("");
  const [createReasoningEffort, setCreateReasoningEffort] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [pendingDeleteAgentName, setPendingDeleteAgentName] = useState<string | null>(null);
  const [editNameDraft, setEditNameDraft] = useState("");
  const [editDescriptionDraft, setEditDescriptionDraft] = useState("");
  const [editDeveloperInstructionsDraft, setEditDeveloperInstructionsDraft] = useState("");
  const [renameManagedFile, setRenameManagedFile] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const [configEditorAgentName, setConfigEditorAgentName] = useState<string | null>(null);
  const [configEditorContent, setConfigEditorContent] = useState("");
  const [configEditorDirty, setConfigEditorDirty] = useState(false);
  const canGenerateCreateFromName = createName.trim().length > 0;
  const effectiveModelOptions = modelOptions.length > 0 ? modelOptions : FALLBACK_AGENT_MODELS;

  useEffect(() => {
    if (!settings) {
      return;
    }
    setMaxThreadsDraft(String(settings.maxThreads));
    setMaxDepthDraft(String(settings.maxDepth));
  }, [settings]);

  const parseMaxThreads = (rawValue: string): number | null => {
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value) || value < MIN_MAX_THREADS || value > MAX_MAX_THREADS) {
      return null;
    }
    return value;
  };

  const parseMaxDepth = (rawValue: string): number | null => {
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value) || value < MIN_MAX_DEPTH || value > MAX_MAX_DEPTH) {
      return null;
    }
    return value;
  };

  const selectedCreateModel = useMemo(
    () => effectiveModelOptions.find((option) => option.model === createModel) ?? null,
    [createModel, effectiveModelOptions],
  );

  const createReasoningOptions = useMemo(() => {
    if (!selectedCreateModel) {
      return [];
    }
    const supported = selectedCreateModel.supportedReasoningEfforts
      .map((option) => option.reasoningEffort.trim().toLowerCase())
      .filter((value) => value.length > 0);
    if (supported.length > 0) {
      return Array.from(new Set(supported));
    }
    const fallback = selectedCreateModel.defaultReasoningEffort?.trim().toLowerCase() ?? "";
    return fallback ? [fallback] : [];
  }, [selectedCreateModel]);

  useEffect(() => {
    if (!effectiveModelOptions.length) {
      return;
    }
    if (
      !createModel ||
      !effectiveModelOptions.some((option) => option.model === createModel)
    ) {
      setCreateModel(effectiveModelOptions[0].model);
    }
  }, [createModel, effectiveModelOptions]);

  useEffect(() => {
    if (createReasoningOptions.length === 0) {
      setCreateReasoningEffort("");
      return;
    }
    if (!createReasoningOptions.includes(createReasoningEffort)) {
      if (createReasoningOptions.includes("medium")) {
        setCreateReasoningEffort("medium");
      } else {
        setCreateReasoningEffort(createReasoningOptions[0]);
      }
    }
  }, [createReasoningEffort, createReasoningOptions]);

  const handleOpenPath = async (path: string) => {
    setOpenPathError(null);
    try {
      await revealItemInDir(path);
    } catch (openError) {
      setOpenPathError(
        openError instanceof Error ? openError.message : String(t("settings.settingsAgents.unableToOpenPath")),
      );
    }
  };

  const handleToggleMultiAgent = async () => {
    if (!settings) {
      return;
    }
    await onSetMultiAgentEnabled(!settings.multiAgentEnabled);
  };

  const handleMaxThreadsChange = async (rawValue: string) => {
    setMaxThreadsDraft(rawValue);
    const parsed = parseMaxThreads(rawValue);
    if (parsed == null) {
      setCreateError(null);
      setEditError(null);
      setOpenPathError(
        String(t("settings.settingsAgents.maxThreadsRangeError", { min: MIN_MAX_THREADS, max: MAX_MAX_THREADS })),
      );
      return;
    }
    setOpenPathError(null);
    if (settings && parsed !== settings.maxThreads) {
      await onSetMaxThreads(parsed);
    }
  };

  const currentMaxThreads = settings
    ? (parseMaxThreads(maxThreadsDraft) ?? settings.maxThreads)
    : MIN_MAX_THREADS;

  const handleMaxThreadsStep = async (delta: number) => {
    if (!settings || isUpdatingCore) {
      return;
    }
    const nextValue = Math.min(
      MAX_MAX_THREADS,
      Math.max(MIN_MAX_THREADS, currentMaxThreads + delta),
    );
    if (nextValue === currentMaxThreads) {
      return;
    }
    await handleMaxThreadsChange(String(nextValue));
  };

  const handleMaxDepthChange = async (rawValue: string) => {
    setMaxDepthDraft(rawValue);
    const parsed = parseMaxDepth(rawValue);
    if (parsed == null) {
      setCreateError(null);
      setEditError(null);
      setOpenPathError(
        String(t("settings.settingsAgents.maxDepthRangeError", { min: MIN_MAX_DEPTH, max: MAX_MAX_DEPTH })),
      );
      return;
    }
    setOpenPathError(null);
    if (settings && parsed !== settings.maxDepth) {
      await onSetMaxDepth(parsed);
    }
  };

  const currentMaxDepth = settings
    ? (parseMaxDepth(maxDepthDraft) ?? settings.maxDepth)
    : MIN_MAX_DEPTH;

  const handleMaxDepthStep = async (delta: number) => {
    if (!settings || isUpdatingCore) {
      return;
    }
    const nextValue = Math.min(
      MAX_MAX_DEPTH,
      Math.max(MIN_MAX_DEPTH, currentMaxDepth + delta),
    );
    if (nextValue === currentMaxDepth) {
      return;
    }
    await handleMaxDepthChange(String(nextValue));
  };

  const handleCreateAgent = async () => {
    const name = createName.trim();
    if (!name) {
      setCreateError(String(t("settings.settingsAgents.agentNameRequired")));
      return;
    }
    setCreateError(null);
    const success = await onCreateAgent({
      name,
      description: createDescription.trim() || null,
      developerInstructions: createDeveloperInstructions.trim() || null,
      template: "blank",
      model: createModel || null,
      reasoningEffort: createReasoningEffort || null,
    });
    if (success) {
      setCreateName("");
      setCreateDescription("");
      setCreateDeveloperInstructions("");
      setCreateReasoningEffort("");
    }
  };

  const startEditing = (agent: NonNullable<SettingsAgentsSectionProps["settings"]>["agents"][number]) => {
    setEditingName(agent.name);
    setEditNameDraft(agent.name);
    setEditDescriptionDraft(agent.description ?? "");
    setEditDeveloperInstructionsDraft(agent.developerInstructions ?? "");
    setRenameManagedFile(true);
    setEditError(null);
  };

  const handleUpdateAgent = async () => {
    if (!editingName) {
      return;
    }
    const nextName = editNameDraft.trim();
    if (!nextName) {
      setEditError(String(t("settings.settingsAgents.agentNameRequired")));
      return;
    }
    const editingAgent = settings?.agents.find((agent) => agent.name === editingName) ?? null;
    const previousDeveloperInstructions =
      editingAgent?.developerInstructions?.trim() ?? "";
    const nextDeveloperInstructions = editDeveloperInstructionsDraft.trim();
    const developerInstructionsChanged =
      nextDeveloperInstructions !== previousDeveloperInstructions;
    setEditError(null);
    const updateInput: Parameters<typeof onUpdateAgent>[0] = {
      originalName: editingName,
      name: nextName,
      description: editDescriptionDraft.trim() || null,
      renameManagedFile,
    };
    if (developerInstructionsChanged) {
      // Send only when explicitly changed so metadata edits don't depend on parsing
      // potentially-invalid per-agent config TOML files.
      updateInput.developerInstructions = editDeveloperInstructionsDraft;
    }
    const success = await onUpdateAgent(updateInput);
    if (success) {
      if (configEditorAgentName === editingName) {
        setConfigEditorAgentName(nextName);
      }
      setEditingName(null);
    }
  };

  const handleDeleteAgent = (name: string) => {
    setPendingDeleteAgentName(name);
  };

  const handleConfirmDeleteAgent = async (name: string) => {
    const success = await onDeleteAgent({ name, deleteManagedFile: true });
    if (!success) {
      return;
    }
    setPendingDeleteAgentName((current) => (current === name ? null : current));
    if (configEditorAgentName === name) {
      setConfigEditorAgentName(null);
      setConfigEditorContent("");
      setConfigEditorDirty(false);
    }
  };

  const handleOpenConfigEditor = async (agentName: string) => {
    const content = await onReadAgentConfig(agentName);
    if (content == null) {
      return;
    }
    setConfigEditorAgentName(agentName);
    setConfigEditorContent(content);
    setConfigEditorDirty(false);
  };

  const handleSaveConfigEditor = async () => {
    if (!configEditorAgentName) {
      return;
    }
    const success = await onWriteAgentConfig(configEditorAgentName, configEditorContent);
    if (success) {
      setConfigEditorDirty(false);
    }
  };

  return (
    <SettingsSection
      title={String(t('settings.sections.agents'))}
      subtitle={String(t('settings.settingsAgents.subtitle'))}
    >
      <div className="settings-help settings-agents-builtins-help">
        <span dangerouslySetInnerHTML={{ __html: String(t("settings.settingsAgents.builtInRolesHelp")) }} />
      </div>

      <SettingsToggleRow
        title={String(t("settings.settingsAgents.configFile"))}
        subtitle={(
          <span
            dangerouslySetInnerHTML={{
              __html: String(t("settings.settingsAgents.openGlobalConfigHelp", { fileManager: fileManagerName() }))
            }}
          />
        )}
      >
        <div className="settings-agents-actions">
          <button type="button" className="ghost" onClick={onRefresh} disabled={isLoading}>
            {String(t("settings.settingsAgents.refresh"))}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => settings && void handleOpenPath(settings.configPath)}
            disabled={!settings}
          >
            {openInFileManagerLabel()}
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={String(t("settings.settingsAgents.enableMultiAgent"))}
        subtitle={
          <span dangerouslySetInnerHTML={{ __html: String(t("settings.settingsAgents.enableMultiAgentHelp")) }} />
        }
      >
        <SettingsToggleSwitch
          pressed={settings?.multiAgentEnabled ?? true}
          onClick={() => void handleToggleMultiAgent()}
          disabled={!settings || isUpdatingCore}
        />
      </SettingsToggleRow>

      <SettingsToggleRow
        title={String(t("settings.settingsAgents.maxThreadsTitle"))}
        subtitle={
          <span dangerouslySetInnerHTML={{ __html: String(t("settings.settingsAgents.maxThreadsHelp")) }} />
        }
      >
        <div className="settings-agents-stepper" role="group" aria-label={String(t("settings.settingsAgents.maximumAgentThreads"))}>
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxThreadsStep(-1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxThreads <= MIN_MAX_THREADS}
            aria-label={String(t("settings.settingsAgents.decreaseMaxThreads"))}
          >
            ▼
          </button>
          <div className="settings-agents-stepper-value" aria-live="polite" aria-atomic="true">
            {currentMaxThreads}
          </div>
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxThreadsStep(1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxThreads >= MAX_MAX_THREADS}
            aria-label={String(t("settings.settingsAgents.increaseMaxThreads"))}
          >
            ▲
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsToggleRow
        title={String(t("settings.settingsAgents.maxDepthTitle"))}
        subtitle={
          <span dangerouslySetInnerHTML={{ __html: String(t("settings.settingsAgents.maxDepthHelp")) }} />
        }
      >
        <div className="settings-agents-stepper" role="group" aria-label={String(t("settings.settingsAgents.maximumAgentDepth"))}>
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxDepthStep(-1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxDepth <= MIN_MAX_DEPTH}
            aria-label={String(t("settings.settingsAgents.decreaseMaxDepth"))}
          >
            ▼
          </button>
          <div className="settings-agents-stepper-value" aria-live="polite" aria-atomic="true">
            {currentMaxDepth}
          </div>
          <button
            type="button"
            className="ghost settings-agents-stepper-button"
            onClick={() => {
              void handleMaxDepthStep(1);
            }}
            disabled={!settings || isUpdatingCore || currentMaxDepth >= MAX_MAX_DEPTH}
            aria-label={String(t("settings.settingsAgents.increaseMaxDepth"))}
          >
            ▲
          </button>
        </div>
      </SettingsToggleRow>

      <SettingsSubsection
        title={String(t("settings.settingsAgents.createAgentTitle"))}
        subtitle={
          <span dangerouslySetInnerHTML={{ __html: String(t("settings.settingsAgents.createAgentHelp")) }} />
        }
      />
      <div className="settings-field settings-agents-form">
        <div className="settings-agents-description-row">
          <label className="settings-label" htmlFor="settings-agent-create-name">
            {String(t("settings.settingsAgents.name"))}
          </label>
          <button
            type="button"
            className="ghost settings-icon-button settings-agents-generate-button"
            onClick={() => {
              if (createDescriptionGenerating || !canGenerateCreateFromName) {
                return;
              }
              void (async () => {
                const generated = await onGenerateCreateDescription({
                  name: createName,
                  description: createDescription,
                  developerInstructions: createDeveloperInstructions,
                });
                if (generated != null) {
                  if (generated.description.trim().length > 0) {
                    setCreateDescription(generated.description);
                  }
                  if (generated.developerInstructions.trim().length > 0) {
                    setCreateDeveloperInstructions(generated.developerInstructions);
                  }
                }
              })();
            }}
            disabled={creatingAgent || createDescriptionGenerating || !canGenerateCreateFromName}
            title={String(t("settings.settingsAgents.generateWithAI"))}
            aria-label={String(t("settings.settingsAgents.generateForNewAgent"))}
          >
            {createDescriptionGenerating ? (
              <MagicSparkleLoaderIcon className="settings-agents-generate-loader" />
            ) : (
              <MagicSparkleIcon />
            )}
          </button>
        </div>
        <input
          id="settings-agent-create-name"
          className="settings-input"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          placeholder={String(t("settings.settingsAgents.researcherPlaceholder"))}
          disabled={creatingAgent}
        />
        <label className="settings-label" htmlFor="settings-agent-create-description">
          {String(t("settings.settingsAgents.description"))}
        </label>
        <textarea
          id="settings-agent-create-description"
          className="settings-agents-textarea settings-agents-textarea--compact"
          value={createDescription}
          onChange={(event) => setCreateDescription(event.target.value)}
          placeholder={String(t("settings.settingsAgents.shortRoleSummary"))}
          rows={2}
          disabled={creatingAgent}
        />
        <label className="settings-label" htmlFor="settings-agent-create-developer-instructions">
          {String(t("settings.settingsAgents.developerInstructions"))}
        </label>
        <textarea
          id="settings-agent-create-developer-instructions"
          className="settings-agents-textarea"
          value={createDeveloperInstructions}
          onChange={(event) => setCreateDeveloperInstructions(event.target.value)}
          placeholder={String(t("settings.settingsAgents.multilineInstructions"))}
          disabled={creatingAgent}
        />
        <div className="settings-agents-model-row">
          <div className="settings-agents-model-field settings-agents-model-field--model">
            <span className="settings-agents-inline-label">{String(t("settings.settingsAgents.modelLabel"))}</span>
            <select
              id="settings-agent-create-model"
              className="settings-select settings-select--compact"
              value={createModel}
              onChange={(event) => setCreateModel(event.target.value)}
              disabled={creatingAgent}
              aria-label={String(t("settings.settingsAgents.model"))}
            >
              {effectiveModelOptions.map((option) => (
                <option key={option.model} value={option.model}>
                  {option.model}
                </option>
              ))}
            </select>
          </div>
          <span className="settings-agents-inline-separator" aria-hidden>
            |
          </span>
          <div className="settings-agents-model-field settings-agents-model-field--effort">
            <span className="settings-agents-inline-label">{String(t("settings.settingsAgents.reasoningLabel"))}</span>
            <select
              id="settings-agent-create-effort"
              className="settings-select settings-select--compact"
              value={createReasoningEffort}
              onChange={(event) => setCreateReasoningEffort(event.target.value)}
              disabled={creatingAgent || createReasoningOptions.length === 0}
              aria-label={String(t("settings.settingsAgents.reasoningEffort"))}
            >
              {createReasoningOptions.length === 0 && <option value="">{String(t("settings.settingsAgents.notSupported"))}</option>}
              {createReasoningOptions.map((effort) => (
                <option key={effort} value={effort}>
                  {formatReasoningEffortLabel(t, effort)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="settings-agents-actions">
          <button type="button" className="ghost" onClick={() => void handleCreateAgent()}>
            {creatingAgent ? String(t("settings.settingsAgents.creating")) : String(t("settings.settingsAgents.createAgentButton"))}
          </button>
        </div>
        {modelOptions.length === 0 && (
          <div className="settings-help">
            {modelOptionsLoading
              ? String(t("settings.settingsAgents.loadingModelsHelp"))
              : String(t("settings.settingsAgents.usingFallbackModels"))}
          </div>
        )}
        {modelOptionsError && <div className="settings-help">{modelOptionsError}</div>}
        {createError && <div className="settings-agents-error">{createError}</div>}
      </div>

      <SettingsSubsection
        title={String(t("settings.settingsAgents.configuredAgents"))}
        subtitle={String(t("settings.settingsAgents.configuredAgentsHelp"))}
      />

      {settings && settings.agents.length === 0 && !isLoading && (
        <div className="settings-help">{String(t("settings.settingsAgents.noAgentsYet"))}</div>
      )}

      {settings?.agents.map((agent) => {
        const isEditing = editingName === agent.name;
        const isPendingDelete = pendingDeleteAgentName === agent.name;
        const isUpdating = updatingAgentName === agent.name;
        const isDeleting = deletingAgentName === agent.name;
        const isReadingConfig = readingConfigAgentName === agent.name;
        const isWritingConfig = writingConfigAgentName === agent.name;
        const isConfigEditorOpen = configEditorAgentName === agent.name;
        const canGenerateEditFromName = editNameDraft.trim().length > 0;
        return (
          <div className="settings-field settings-agent-card" key={agent.name}>
            <div className="settings-agent-card-header">
              <div>
                <div className="settings-toggle-title">{agent.name}</div>
                <div className="settings-toggle-subtitle">
                  {agent.description || String(t("settings.settingsAgents.noDescription"))}
                </div>
              </div>
            </div>

            <div className="settings-help settings-help-inline">
              <code>{agent.configFile || String(t("settings.settingsAgents.missingConfigFile"))}</code>
            </div>
            <div className="settings-agents-actions">
              {!isPendingDelete && (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => startEditing(agent)}
                    disabled={isUpdating || isDeleting}
                  >
                    {String(t("settings.settingsAgents.edit"))}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => handleDeleteAgent(agent.name)}
                    disabled={isUpdating || isDeleting}
                  >
                    {String(t("settings.settingsAgents.delete"))}
                  </button>
                </>
              )}
              <button
                type="button"
                className="ghost"
                onClick={() => void handleOpenPath(agent.resolvedPath)}
              >
                {openInFileManagerLabel()}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void handleOpenConfigEditor(agent.name)}
                disabled={!agent.managedByApp || isReadingConfig || isWritingConfig}
              >
                {isReadingConfig ? "Opening..." : String(t("settings.settingsAgents.edit"))}
              </button>
              {!agent.managedByApp && (
                <span className="settings-help settings-help-inline">{String(t("settings.settingsAgents.externalPath"))}</span>
              )}
            </div>
            {isPendingDelete && (
              <div className="settings-agents-actions">
                <span className="settings-help settings-help-inline">
                  {String(t("settings.settingsAgents.deleteAgentQuestion"))}
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setPendingDeleteAgentName(null);
                  }}
                  disabled={isDeleting}
                >
                  {String(t("common.cancel"))}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void handleConfirmDeleteAgent(agent.name)}
                  disabled={isDeleting}
                >
                  {isDeleting ? String(t("settings.settingsAgents.deleting")) : String(t("settings.settingsAgents.confirmDeleteButton"))}
                </button>
              </div>
            )}

            {isEditing && (
              <div className="settings-agents-edit-form">
                <div className="settings-agents-description-row">
                  <label
                    className="settings-label"
                    htmlFor={`settings-agent-edit-name-${agent.name}`}
                  >
                    {String(t("settings.settingsAgents.name"))}
                  </label>
                  <button
                    type="button"
                    className="ghost settings-icon-button settings-agents-generate-button"
                    onClick={() => {
                      if (editDescriptionGenerating || !canGenerateEditFromName) {
                        return;
                      }
                      void (async () => {
                        const generated = await onGenerateEditDescription({
                          name: editNameDraft || agent.name,
                          description: editDescriptionDraft,
                          developerInstructions: editDeveloperInstructionsDraft,
                        });
                        if (generated != null) {
                          if (generated.description.trim().length > 0) {
                            setEditDescriptionDraft(generated.description);
                          }
                          if (generated.developerInstructions.trim().length > 0) {
                            setEditDeveloperInstructionsDraft(generated.developerInstructions);
                          }
                        }
                      })();
                    }}
                    disabled={
                      isUpdating || editDescriptionGenerating || !canGenerateEditFromName
                    }
                    title={String(t("settings.settingsAgents.generateWithAI"))}
                    aria-label={`Generate fields for ${agent.name}`}
                  >
                    {editDescriptionGenerating ? (
                      <MagicSparkleLoaderIcon className="settings-agents-generate-loader" />
                    ) : (
                      <MagicSparkleIcon />
                    )}
                  </button>
                </div>
                <input
                  id={`settings-agent-edit-name-${agent.name}`}
                  className="settings-input"
                  value={editNameDraft}
                  onChange={(event) => setEditNameDraft(event.target.value)}
                  disabled={isUpdating}
                />
                <label
                  className="settings-label"
                  htmlFor={`settings-agent-edit-description-${agent.name}`}
                >
                  {String(t("settings.settingsAgents.description"))}
                </label>
                <textarea
                  id={`settings-agent-edit-description-${agent.name}`}
                  className="settings-agents-textarea settings-agents-textarea--compact"
                  value={editDescriptionDraft}
                  onChange={(event) => setEditDescriptionDraft(event.target.value)}
                  placeholder={String(t("settings.settingsAgents.shortRoleSummary"))}
                  rows={2}
                  disabled={isUpdating}
                />
                <label
                  className="settings-label"
                  htmlFor={`settings-agent-edit-developer-instructions-${agent.name}`}
                >
                  {String(t("settings.settingsAgents.developerInstructions"))}
                </label>
                <textarea
                  id={`settings-agent-edit-developer-instructions-${agent.name}`}
                  className="settings-agents-textarea"
                  value={editDeveloperInstructionsDraft}
                  onChange={(event) =>
                    setEditDeveloperInstructionsDraft(event.target.value)
                  }
                  placeholder={String(t("settings.settingsAgents.multilineInstructions"))}
                  disabled={isUpdating}
                />
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    checked={renameManagedFile}
                    onChange={(event) => setRenameManagedFile(event.target.checked)}
                  />
                  {String(t("settings.settingsAgents.renameManagedFileHelp"))}
                </label>
                <div className="settings-agents-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setEditingName(null);
                      setEditError(null);
                    }}
                    disabled={isUpdating}
                  >
                    {String(t("common.cancel"))}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void handleUpdateAgent()}
                    disabled={isUpdating}
                  >
                    {isUpdating ? String(t("settings.settingsAgents.saving")) : String(t("settings.settingsAgents.save"))}
                  </button>
                </div>
                {editError && <div className="settings-agents-error">{editError}</div>}
              </div>
            )}

            {isConfigEditorOpen && (
              <div className="settings-field settings-agents-editor">
                <div className="settings-agents-header">
                  <div>
                    <div className="settings-toggle-title">{agent.name} {String(t("settings.settingsAgents.configFileTitle"))}</div>
                    <div className="settings-toggle-subtitle">
                      <code>{agent.configFile}</code>
                    </div>
                  </div>
                  <div className="settings-agents-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setConfigEditorAgentName(null);
                        setConfigEditorDirty(false);
                      }}
                    >
                      {String(t("settings.settingsAgents.close"))}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void handleSaveConfigEditor()}
                      disabled={!configEditorDirty || writingConfigAgentName === agent.name}
                    >
                      {isWritingConfig ? String(t("settings.settingsAgents.saving")) : String(t("settings.settingsAgents.save"))}
                    </button>
                  </div>
                </div>
                <textarea
                  className="settings-agents-textarea"
                  value={configEditorContent}
                  onChange={(event) => {
                    setConfigEditorContent(event.target.value);
                    setConfigEditorDirty(true);
                  }}
                />
              </div>
            )}
          </div>
        );
      })}

      {isLoading && <div className="settings-help">{String(t("settings.settingsAgents.loadingAgentsSettings"))}</div>}
      {openPathError && <div className="settings-agents-error">{openPathError}</div>}
      {error && <div className="settings-agents-error">{error}</div>}

      <div className="settings-divider" />
      <div className="settings-field-label settings-field-label--section">
        {String(t('settings.settingsCodex.defaultParameters'))}
      </div>

      <SettingsToggleRow
        title={
          <label htmlFor="default-access">
            {String(t('settings.settingsCodex.accessMode'))}
          </label>
        }
        subtitle={String(t('settings.settingsCodex.accessModeHelp'))}
      >
        <select
          id="default-access"
          className="settings-select"
          value={appSettings.defaultAccessMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              defaultAccessMode: event.target.value as AppSettings["defaultAccessMode"],
            })
          }
        >
          <option value="read-only">{String(t('settings.settingsCodex.readOnly'))}</option>
          <option value="current">{String(t('settings.settingsCodex.onRequest'))}</option>
          <option value="full-access">{String(t('settings.settingsCodex.fullAccess'))}</option>
        </select>
      </SettingsToggleRow>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="review-delivery">
          {String(t('settings.settingsCodex.reviewMode'))}
        </label>
        <select
          id="review-delivery"
          className="settings-select"
          value={appSettings.reviewDeliveryMode}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              reviewDeliveryMode: event.target.value as AppSettings["reviewDeliveryMode"],
            })
          }
        >
          <option value="inline">{String(t('settings.settingsCodex.inline'))}</option>
          <option value="detached">{String(t('settings.settingsCodex.detached'))}</option>
        </select>
        <div className="settings-help">
          {String(t('settings.settingsCodex.reviewModeHelp'))}
        </div>
      </div>

      <FileEditorCard
        title={String(t('settings.settingsCodex.globalAgentsTitle'))}
        meta={globalAgentsMeta}
        error={globalAgentsError}
        value={globalAgentsContent}
        placeholder={String(t('settings.settingsCodex.globalAgentsPlaceholder'))}
        disabled={globalAgentsLoading}
        refreshDisabled={globalAgentsRefreshDisabled}
        saveDisabled={globalAgentsSaveDisabled}
        saveLabel={globalAgentsSaveLabel}
        onChange={onSetGlobalAgentsContent}
        onRefresh={onRefreshGlobalAgents}
        onSave={onSaveGlobalAgents}
        helpText={
          <>
            Stored at <code>{globalAgentsPath.trim() || "cli/AGENTS.md"}</code>.
          </>
        }
        classNames={{
          container: "settings-field settings-agents",
          header: "settings-agents-header",
          title: "settings-field-label",
          actions: "settings-agents-actions",
          meta: "settings-help settings-help-inline",
          iconButton: "ghost settings-icon-button",
          error: "settings-agents-error",
          textarea: "settings-agents-textarea",
          help: "settings-help",
        }}
      />

      <FileEditorCard
        title={String(t('settings.settingsCodex.globalConfigTitle'))}
        meta={globalConfigMeta}
        error={globalConfigError}
        value={globalConfigContent}
        placeholder={String(t('settings.settingsCodex.globalConfigPlaceholder'))}
        disabled={globalConfigLoading}
        refreshDisabled={globalConfigRefreshDisabled}
        saveDisabled={globalConfigSaveDisabled}
        saveLabel={globalConfigSaveLabel}
        onChange={onSetGlobalConfigContent}
        onRefresh={onRefreshGlobalConfig}
        onSave={onSaveGlobalConfig}
        helpText={
          <>
            Stored at <code>{globalConfigPath.trim() || "cli/config.toml"}</code>.
          </>
        }
        classNames={{
          container: "settings-field settings-agents",
          header: "settings-agents-header",
          title: "settings-field-label",
          actions: "settings-agents-actions",
          meta: "settings-help settings-help-inline",
          iconButton: "ghost settings-icon-button",
          error: "settings-agents-error",
          textarea: "settings-agents-textarea",
          help: "settings-help",
        }}
      />
    </SettingsSection>
  );
}
