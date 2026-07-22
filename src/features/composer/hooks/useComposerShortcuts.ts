import { useEffect } from "react";
import type { AccessMode } from "../../../types";
import { matchesShortcut } from "../../../utils/shortcuts";

/**
 * 模型选项类型
 */
type ModelOption = { id: string; displayName: string; model: string };

/**
 * Composer 快捷键钩子选项
 */
type UseComposerShortcutsOptions = {
  /** 文本区域引用 */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 模型切换快捷键 */
  modelShortcut: string | null;
  /** 访问模式切换快捷键 */
  accessShortcut: string | null;
  /** 推理级别切换快捷键 */
  reasoningShortcut: string | null;
  /** 协作模式切换快捷键 */
  collaborationShortcut: string | null;
  /** 可用模型列表 */
  models: ModelOption[];
  /** 协作模式列表 */
  collaborationModes: { id: string; label: string }[];
  /** 当前选中的模型ID */
  selectedModelId: string | null;
  /** 模型选择回调 */
  onSelectModel: (id: string) => void;
  /** 当前选中的协作模式ID */
  selectedCollaborationModeId: string | null;
  /** 协作模式选择回调 */
  onSelectCollaborationMode: (id: string | null) => void;
  /** 当前访问模式 */
  accessMode: AccessMode;
  /** 访问模式选择回调 */
  onSelectAccessMode: (mode: AccessMode) => void;
  /** 推理选项列表 */
  reasoningOptions: string[];
  /** 当前选中的推理级别 */
  selectedEffort: string | null;
  /** 推理级别选择回调 */
  onSelectEffort: (effort: string) => void;
  /** 是否支持推理功能 */
  reasoningSupported: boolean;
};

/** 访问模式切换顺序 */
const ACCESS_ORDER: AccessMode[] = ["read-only", "current", "full-access"];

/**
 * Composer 快捷键钩子
 * 处理编辑器的各种快捷键操作，包括模型切换、访问模式切换等
 */
export function useComposerShortcuts({
  textareaRef,
  modelShortcut,
  accessShortcut,
  reasoningShortcut,
  collaborationShortcut,
  models,
  collaborationModes,
  selectedModelId,
  onSelectModel,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  accessMode,
  onSelectAccessMode,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
}: UseComposerShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (document.activeElement !== textareaRef.current) {
        return;
      }
      if (matchesShortcut(event, modelShortcut)) {
        event.preventDefault();
        if (models.length === 0) {
          return;
        }
        const currentIndex = models.findIndex((model) => model.id === selectedModelId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % models.length : 0;
        const nextModel = models[nextIndex];
        if (nextModel) {
          onSelectModel(nextModel.id);
        }
        return;
      }
      if (matchesShortcut(event, accessShortcut)) {
        event.preventDefault();
        const currentIndex = ACCESS_ORDER.indexOf(accessMode);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % ACCESS_ORDER.length : 0;
        const nextAccess = ACCESS_ORDER[nextIndex];
        if (nextAccess) {
          onSelectAccessMode(nextAccess);
        }
        return;
      }
      if (matchesShortcut(event, reasoningShortcut)) {
        event.preventDefault();
        if (!reasoningSupported || reasoningOptions.length === 0) {
          return;
        }
        const currentIndex = reasoningOptions.indexOf(selectedEffort ?? "");
        const nextIndex =
          currentIndex >= 0 ? (currentIndex + 1) % reasoningOptions.length : 0;
        const nextEffort = reasoningOptions[nextIndex];
        if (nextEffort) {
          onSelectEffort(nextEffort);
        }
        return;
      }
      if (
        collaborationModes.length > 0 &&
        matchesShortcut(event, collaborationShortcut)
      ) {
        event.preventDefault();
        const currentIndex = collaborationModes.findIndex(
          (mode) => mode.id === selectedCollaborationModeId,
        );
        const nextIndex =
          currentIndex >= 0
            ? (currentIndex + 1) % collaborationModes.length
            : 0;
        const nextMode = collaborationModes[nextIndex];
        if (nextMode) {
          onSelectCollaborationMode(nextMode.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    accessMode,
    accessShortcut,
    collaborationModes,
    collaborationShortcut,
    modelShortcut,
    models,
    onSelectCollaborationMode,
    onSelectAccessMode,
    onSelectEffort,
    onSelectModel,
    reasoningOptions,
    reasoningShortcut,
    reasoningSupported,
    selectedCollaborationModeId,
    selectedEffort,
    selectedModelId,
    textareaRef,
  ]);
}
