import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type {
  AccessMode,
  AppOption,
  CustomPromptOption,
  ModelOption,
  PluginOption,
  ServiceTier,
  SkillOption,
  ThreadTokenUsage,
  WorkspaceInfo,
} from "../../../types";
import { ComposerInput } from "../../composer/components/ComposerInput";
import { useComposerImages } from "../../composer/hooks/useComposerImages";
import { useComposerImageDrop } from "../../composer/hooks/useComposerImageDrop";
import { useComposerAutocompleteState } from "../../composer/hooks/useComposerAutocompleteState";
import { usePromptHistory } from "../../composer/hooks/usePromptHistory";
import { isImageAttachmentPath } from "../../threads/hooks/threadMessagingHelpers";
import type {
  WorkspaceHomeRun,
  WorkspaceHomeRunInstance,
  WorkspaceRunMode,
} from "../hooks/useWorkspaceHome";
import { isComposingEvent } from "../../../utils/keys";
import Folder from "lucide-react/dist/esm/icons/folder";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { WorkspaceHomeHistory } from "./WorkspaceHomeHistory";
import { WorkspaceHomeGitInitBanner } from "./WorkspaceHomeGitInitBanner";
import { useWorkspaceHomeSuggestionsStyle } from "../hooks/useWorkspaceHomeSuggestionsStyle";
import type { ThreadStatusById } from "../../../utils/threadStatus";
import { useMenuController } from "../../app/hooks/useMenuController";
import {
  MenuTrigger,
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";

type WorkspaceHomeProps = {
  workspace: WorkspaceInfo;
  availableWorkspaces: WorkspaceInfo[];
  onSelectWorkspace: (workspaceId: string) => void;
  showGitInitBanner: boolean;
  initGitRepoLoading: boolean;
  onInitGitRepo: () => void | Promise<void>;
  runs: WorkspaceHomeRun[];
  recentThreadInstances: WorkspaceHomeRunInstance[];
  recentThreadsUpdatedAt: number | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  onStartRun: (images?: string[]) => Promise<boolean>;
  runMode: WorkspaceRunMode;
  onRunModeChange: (mode: WorkspaceRunMode) => void;
  models: ModelOption[];
  selectedModelId: string | null;
  onSelectModel: (modelId: string) => void;
  modelSelections: Record<string, number>;
  onToggleModel: (modelId: string) => void;
  onModelCountChange: (modelId: string, count: number) => void;
  collaborationModes: { id: string; label: string }[];
  selectedCollaborationModeId: string | null;
  onSelectCollaborationMode: (id: string | null) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  onSelectEffort: (effort: string) => void;
  reasoningSupported: boolean;
  selectedServiceTier: ServiceTier | null;
  accessMode: AccessMode;
  onSelectAccessMode: (mode: AccessMode) => void;
  contextUsage?: ThreadTokenUsage | null;
  error: string | null;
  isSubmitting: boolean;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  threadStatusById: ThreadStatusById;
  onSelectInstance: (workspaceId: string, threadId: string) => void;
  skills: SkillOption[];
  plugins: PluginOption[];
  onRefreshSkills?: () => void | Promise<void>;
  onRefreshPlugins?: () => void | Promise<void>;
  appsEnabled: boolean;
  apps: AppOption[];
  prompts: CustomPromptOption[];
  files: string[];
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onFileAutocompleteActiveChange?: (active: boolean) => void;
  agentMdContent: string;
  agentMdExists: boolean;
  agentMdTruncated: boolean;
  agentMdLoading: boolean;
  agentMdSaving: boolean;
  agentMdError: string | null;
  agentMdDirty: boolean;
  onAgentMdChange: (value: string) => void;
  onAgentMdRefresh: () => void;
  onAgentMdSave: () => void;
  onPreviewAttachment?: (path: string) => void;
  attachments?: string[];
  onPickImages?: () => void | Promise<void>;
  onAttachImages?: (paths: string[]) => void;
  onRemoveAttachment?: (path: string) => void;
  onClearAttachments?: () => void;
  onToggleTerminal?: () => void;
  terminalOpen?: boolean;
};

export function WorkspaceHome({
  workspace,
  availableWorkspaces,
  onSelectWorkspace,
  showGitInitBanner,
  initGitRepoLoading,
  onInitGitRepo,
  runs,
  recentThreadInstances,
  recentThreadsUpdatedAt,
  prompt,
  onPromptChange,
  onStartRun,
  models,
  selectedModelId,
  onSelectModel,
  collaborationModes,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  selectedServiceTier,
  accessMode,
  onSelectAccessMode,
  contextUsage = null,
  error,
  isSubmitting,
  activeWorkspaceId,
  activeThreadId,
  threadStatusById,
  onSelectInstance,
  skills,
  plugins = [],
  onRefreshSkills,
  onRefreshPlugins,
  appsEnabled,
  apps,
  prompts,
  files,
  textareaRef: textareaRefProp,
  onFileAutocompleteActiveChange,
  onPreviewAttachment,
  attachments: _attachmentsProp,
  onPickImages: _onPickImagesProp,
  onAttachImages: _onAttachImagesProp,
  onRemoveAttachment: _onRemoveAttachmentProp,
  onClearAttachments: onClearAttachmentsProp,
  onToggleTerminal,
  terminalOpen = false,
}: WorkspaceHomeProps) {
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const fallbackTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = textareaRefProp ?? fallbackTextareaRef;
  const workspaceMenu = useMenuController();
  const {
    activeImages: localActiveImages,
    attachImages: attachLocalImages,
    removeImage: removeLocalImage,
    clearActiveImages: clearLocalActiveImages,
  } = useComposerImages({
    activeThreadId: null,
    activeWorkspaceId: workspace.id,
  });
  const attachments = _attachmentsProp ?? localActiveImages;
  const attachImages = _onAttachImagesProp ?? attachLocalImages;
  const removeAttachment = _onRemoveAttachmentProp ?? removeLocalImage;
  const clearActiveImages = onClearAttachmentsProp ?? clearLocalActiveImages;
  const insertFileReferences = (paths: string[]) => {
    const normalized = Array.from(
      new Set(paths.map((path) => path.trim()).filter(Boolean)),
    );
    if (normalized.length === 0) {
      return;
    }
    const selectionBegin = textareaRef.current?.selectionStart ?? prompt.length;
    const selectionEnd = textareaRef.current?.selectionEnd ?? selectionBegin;
    const before = prompt.slice(0, selectionBegin);
    const after = prompt.slice(selectionEnd);
    const insert = normalized.map((path) => `@'${path}'`).join(" ");
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
    const nextText = `${before}${needsLeadingSpace ? " " : ""}${insert}${needsTrailingSpace ? " " : ""}${after}`;
    const nextCursor = before.length + (needsLeadingSpace ? 1 : 0) + insert.length;
    onPromptChange(nextText);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
      setSelectionStart(nextCursor);
    });
  };
  const {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  } = useComposerImageDrop({
    disabled: isSubmitting,
    onAttachFiles: (paths) => {
      const imagePaths = paths.filter((path) => isImageAttachmentPath(path.trim()));
      const filePaths = paths.filter((path) => !isImageAttachmentPath(path.trim()));
      if (imagePaths.length > 0) {
        attachImages(imagePaths);
      }
      if (filePaths.length > 0) {
        insertFileReferences(filePaths);
      }
    },
    onAttachImages: attachImages,
  });

  const {
    isAutocompleteOpen,
    autocompleteMatches,
    autocompleteAnchorIndex,
    highlightIndex,
    setHighlightIndex,
    applyAutocomplete,
    handleInputKeyDown,
    handleTextChange,
    handleSelectionChange,
    fileTriggerActive,
  } = useComposerAutocompleteState({
    text: prompt,
    selectionStart,
    disabled: isSubmitting,
    appsEnabled,
    skills,
    plugins,
    apps,
    prompts,
    files,
    textareaRef,
    setText: onPromptChange,
    setSelectionStart,
    onSkillTrigger: () => {
      void onRefreshSkills?.();
      void onRefreshPlugins?.();
    },
  });

  const suggestionsStyle = useWorkspaceHomeSuggestionsStyle({
    isAutocompleteOpen,
    autocompleteAnchorIndex,
    selectionStart,
    prompt,
    textareaRef,
  });

  useEffect(() => {
    onFileAutocompleteActiveChange?.(fileTriggerActive);
  }, [fileTriggerActive, onFileAutocompleteActiveChange]);

  const {
    handleHistoryKeyDown,
    handleHistoryTextChange,
    recordHistory,
    resetHistoryNavigation,
  } = usePromptHistory({
    historyKey: workspace.id,
    text: prompt,
    hasAttachments: attachments.length > 0,
    disabled: isSubmitting,
    isAutocompleteOpen,
    textareaRef,
    setText: onPromptChange,
    setSelectionStart,
  });

  const handleTextChangeWithHistory = (next: string, cursor: number | null) => {
    handleHistoryTextChange(next);
    handleTextChange(next, cursor);
  };

  const handleRunSubmit = async () => {
    if (!prompt.trim() && attachments.length === 0) {
      return;
    }
    const didStart = await onStartRun(attachments);
    if (didStart) {
      const trimmed = prompt.trim();
      if (trimmed) {
        recordHistory(trimmed);
      }
      resetHistoryNavigation();
      clearActiveImages();
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingEvent(event)) {
      return;
    }

    handleHistoryKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }

    handleInputKeyDown(event);
    if (event.defaultPrevented) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleRunSubmit();
    }
  };

  return (
    <div
      className={`workspace-home${isDragOver ? " is-drag-over" : ""}`}
      ref={dropTargetRef}
      onDragOver={handleDragOver as (event: DragEvent<HTMLDivElement>) => void}
      onDragEnter={handleDragEnter as (event: DragEvent<HTMLDivElement>) => void}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop as (event: DragEvent<HTMLDivElement>) => void}
    >
      <div className="workspace-home-hero">
        <div className="workspace-home-title">
          我们能在 {workspace.name} 中做什么？
        </div>
      </div>

      {showGitInitBanner && (
        <WorkspaceHomeGitInitBanner
          isLoading={initGitRepoLoading}
          onInitGitRepo={onInitGitRepo}
        />
      )}

      <div className="workspace-home-composer">
        <div className="composer">
          <ComposerInput
            workspacePath={workspace.path}
            plugins={plugins}
            text={prompt}
            disabled={isSubmitting}
            sendLabel="Send"
            canStop={false}
            canSend={prompt.trim().length > 0}
            isProcessing={isSubmitting}
            onStop={() => {}}
            onSend={() => {
              void handleRunSubmit();
            }}
            attachments={attachments}
            onPreviewAttachment={onPreviewAttachment}
            onAddAttachment={_onPickImagesProp}
            onAttachImages={attachImages}
            onRemoveAttachment={removeAttachment}
            isDragOverExternal={isDragOver}
            onDropAreaDragOver={handleDragOver}
            onDropAreaDragEnter={handleDragEnter}
            onDropAreaDragLeave={handleDragLeave}
            onTextChange={handleTextChangeWithHistory}
            onSelectionChange={handleSelectionChange}
            onKeyDown={handleComposerKeyDown}
            isExpanded={false}
            textareaRef={textareaRef}
            selectionStart={selectionStart}
            suggestionsOpen={isAutocompleteOpen}
            suggestions={autocompleteMatches}
            highlightIndex={highlightIndex}
            onHighlightIndex={setHighlightIndex}
            onSelectSuggestion={applyAutocomplete}
            suggestionsStyle={suggestionsStyle}
            // MetaBar props
            collaborationModes={collaborationModes}
            selectedCollaborationModeId={selectedCollaborationModeId}
            onSelectCollaborationMode={onSelectCollaborationMode}
            models={models}
            selectedModelId={selectedModelId}
            onSelectModel={onSelectModel}
            reasoningOptions={reasoningOptions}
            selectedEffort={selectedEffort}
            onSelectEffort={onSelectEffort}
            selectedServiceTier={selectedServiceTier}
            reasoningSupported={reasoningSupported}
            accessMode={accessMode}
            onSelectAccessMode={onSelectAccessMode}
            contextUsage={contextUsage}
            onToggleTerminal={onToggleTerminal}
            terminalOpen={terminalOpen}
          />
        </div>
        {error && <div className="workspace-home-error">{error}</div>}
      </div>

      <div className="workspace-home-work-directory">
        <div
          className="workspace-home-work-directory-menu"
          ref={workspaceMenu.containerRef}
        >
          <MenuTrigger
            isOpen={workspaceMenu.isOpen}
            className="workspace-home-work-directory-trigger"
            onClick={workspaceMenu.toggle}
            aria-label="切换工作目录"
            title={workspace.path}
          >
            <Folder size={14} className="workspace-home-work-directory-icon" />
            <span className="workspace-home-work-directory-name">{workspace.name}</span>
            <ChevronDown size={14} className="workspace-home-work-directory-arrow" />
          </MenuTrigger>
          {workspaceMenu.isOpen && (
            <PopoverSurface className="workspace-home-work-directory-popover" role="menu">
              {availableWorkspaces.map((entry) => (
                <PopoverMenuItem
                  key={entry.id}
                  className="workspace-home-work-directory-item"
                  description={entry.path}
                  onClick={() => {
                    onSelectWorkspace(entry.id);
                    workspaceMenu.close();
                  }}
                >
                  {entry.name}
                </PopoverMenuItem>
              ))}
            </PopoverSurface>
          )}
        </div>
      </div>

      <WorkspaceHomeHistory
        runs={runs}
        recentThreadInstances={recentThreadInstances}
        recentThreadsUpdatedAt={recentThreadsUpdatedAt}
        activeWorkspaceId={activeWorkspaceId}
        activeThreadId={activeThreadId}
        threadStatusById={threadStatusById}
        onSelectInstance={onSelectInstance}
      />
    </div>
  );
}
