import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AutocompleteItem } from "./useComposerAutocomplete";
import { useComposerAutocomplete } from "./useComposerAutocomplete";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type {
  AppOption,
  CustomPromptOption,
  PluginOption,
  SkillOption,
} from "../../../types";
import { connectorMentionSlug } from "../../apps/utils/appMentions";
import {
  buildPromptInsertText,
  findNextPromptArgCursor,
  findPromptArgRangeAtCursor,
  getPromptArgumentHint,
} from "../../../utils/customPrompts";
import { isComposingEvent } from "../../../utils/keys";

/**
 * 技能类型
 */
/**
 * Composer 自动完成状态钩子参数
 */
type UseComposerAutocompleteStateArgs = {
  /** 文本内容 */
  text: string;
  /** 选择起始位置 */
  selectionStart: number | null;
  /** 是否禁用 */
  disabled: boolean;
  /** 是否启用应用集成 */
  appsEnabled: boolean;
  /** 技能列表 */
  skills: SkillOption[];
  /** 插件列表 */
  plugins: PluginOption[];
  /** 应用选项列表 */
  apps: AppOption[];
  /** 自定义提示选项列表 */
  prompts: CustomPromptOption[];
  /** 可用文件列表 */
  files: string[];
  /** 文本区域引用 */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** 设置文本回调 */
  setText: (next: string) => void;
  /** 设置选择起始位置回调 */
  setSelectionStart: (next: number | null) => void;
  /** 项目应用回调 */
  onItemApplied?: (
    item: AutocompleteItem,
    context: { triggerChar: string; insertedText: string },
  ) => void;
  onSendAutocompleteItem?: (item: AutocompleteItem, insertedText: string) => void;
  /** 触发 skill 列表刷新 */
  onSkillTrigger?: () => void;
};

/** 最大文件建议数量 */
const MAX_FILE_SUGGESTIONS = 500;
const FILE_TRIGGER_REGEX = /(?:^|[\s"'`([{])@(?:'([^'\n]*)|([^\s"'`)\]}]*))$/;

function buildSkillInsertText(skill: SkillOption) {
  const skillName = skill.name.trim();
  const skillPath = skill.path.trim();
  return `[$${skillName}:${skillName}](${skillPath})`;
}

function buildPluginInsertText(plugin: PluginOption) {
  const pluginName = plugin.name.trim().replace(/\s+/g, "");
  const pluginPath = plugin.path.trim();
  return `[$plugin:${pluginName}](${pluginPath})`;
}

function buildFileInsertText(path: string) {
  return `@'${path.trim()}'`;
}

/**
 * 判断文件触发器是否激活
 * @param text - 文本内容
 * @param cursor - 光标位置
 * @returns 是否激活文件触发器
 */
function getFileTriggerMatch(text: string, cursor: number | null) {
  if (!text || cursor === null) {
    return null;
  }
  return FILE_TRIGGER_REGEX.exec(text.slice(0, cursor));
}

function isFileTriggerActive(text: string, cursor: number | null) {
  const match = getFileTriggerMatch(text, cursor);
  if (!match) {
    return false;
  }
  return match[1] !== undefined || (match[2] ?? "").length > 0;
}

function getFileTriggerQuery(text: string, cursor: number | null) {
  const match = getFileTriggerMatch(text, cursor);
  return match ? (match[1] ?? match[2] ?? "") : null;
}

export function useComposerAutocompleteState({
  text,
  selectionStart,
  disabled,
  appsEnabled,
  skills,
  plugins = [],
  apps,
  prompts,
  files,
  textareaRef,
  setText,
  setSelectionStart,
  onItemApplied,
  onSendAutocompleteItem,
  onSkillTrigger,
}: UseComposerAutocompleteStateArgs) {
  const { t } = useI18nSafe();
  const skillItems = useMemo<AutocompleteItem[]>(
    () =>
      skills.map((skill) => ({
        id: `skill:${skill.name}`,
        label: skill.name,
        description: skill.description,
        insertText: buildSkillInsertText(skill),
        group: "Skills" as const,
        skillPath: skill.path,
      })),
    [skills],
  );

  const pluginItems = useMemo<AutocompleteItem[]>(
    () =>
      plugins.map((plugin) => ({
        id: `plugin:${plugin.key}`,
        label: plugin.name,
        description: plugin.description,
        insertText: buildPluginInsertText(plugin),
        group: "Plugins" as const,
        pluginPath: plugin.path,
        iconDataUrl: plugin.iconDataUrl,
        brandColor: plugin.brandColor,
      })),
    [plugins],
  );

  const appItems = useMemo<AutocompleteItem[]>(
    () =>
      apps
        .filter((app) => app.isAccessible)
        .map((app) => ({
          id: `app:${app.id}`,
          label: app.name,
          description: app.description,
          insertText: connectorMentionSlug(app.name),
          group: "Apps" as const,
          mentionPath: `app://${app.id}`,
        })),
    [apps],
  );

  const fileTriggerActive = useMemo(
    () => isFileTriggerActive(text, selectionStart),
    [selectionStart, text],
  );
  const fileItems = useMemo<AutocompleteItem[]>(
    () =>
      fileTriggerActive
        ? (() => {
            const query = getFileTriggerQuery(text, selectionStart) ?? "";
            const limited = query ? files : files.slice(0, MAX_FILE_SUGGESTIONS);
            return limited.map((path) => ({
              id: path,
              label: path,
              insertText: buildFileInsertText(path),
              group: "Files" as const,
            }));
          })()
        : [],
    [fileTriggerActive, files, selectionStart, text],
  );

  const promptItems = useMemo<AutocompleteItem[]>(
    () =>
      prompts
        .filter((prompt) => prompt.name)
        .map((prompt) => {
          const insert = buildPromptInsertText(prompt);
          return {
            id: `prompt:${prompt.name}`,
            label: `prompts:${prompt.name}`,
            description: prompt.description,
            hint: getPromptArgumentHint(prompt),
            insertText: insert.text,
            cursorOffset: insert.cursorOffset,
            group: "Prompts" as const,
          };
        }),
    [prompts],
  );

  const slashCommandItems = useMemo<AutocompleteItem[]>(() => {
    const commandIds = [
      "compact",
      "fast",
      "fork",
      "goal",
      "mcp",
      "new",
      "plan",
      "resume",
      "review",
      "status",
    ];
    const commands: AutocompleteItem[] = commandIds.map((id) => ({
      id,
      label: id,
      displayTitle: String(t(`composer.slashCommandTitles.${id}`)),
      description: String(t(`composer.slashCommands.${id}`)),
      insertText: `/${id}`,
      group: "Slash" as const,
      action: "send" as const,
    }));
    if (appsEnabled) {
      commands.push({
        id: "apps",
        label: "apps",
        displayTitle: String(t("composer.slashCommandTitles.apps")),
        description: String(t("composer.slashCommands.apps")),
        insertText: "/apps",
        group: "Slash",
        action: "send",
      });
    }
    return commands.sort((a, b) => a.label.localeCompare(b.label));
  }, [appsEnabled, t]);

  const slashItems = useMemo<AutocompleteItem[]>(
    () => [...slashCommandItems, ...promptItems, ...pluginItems, ...skillItems],
    [pluginItems, promptItems, skillItems, slashCommandItems],
  );

  const triggers = useMemo(
    () => [
      { trigger: "/", items: slashItems },
      { trigger: "$", items: [...pluginItems, ...skillItems, ...appItems] },
      { trigger: "@", items: fileItems },
    ],
    [appItems, fileItems, pluginItems, skillItems, slashItems],
  );

  const {
    active: isAutocompleteOpen,
    matches: autocompleteMatches,
    highlightIndex,
    setHighlightIndex,
    moveHighlight,
    range: autocompleteRange,
    close: closeAutocomplete,
  } = useComposerAutocomplete({
    text,
    selectionStart,
    triggers,
  });
  const autocompleteAnchorIndex = autocompleteRange
    ? Math.max(0, autocompleteRange.start - 1)
    : null;
  const lastTriggeredAutocompleteRef = useRef<string | null>(null);

  useEffect(() => {
    const activeTrigger =
      isAutocompleteOpen && (autocompleteRange?.start ?? 0) > 0
        ? text[autocompleteRange!.start - 1] ?? null
        : null;

    if (
      (activeTrigger === "$" || activeTrigger === "/") &&
      lastTriggeredAutocompleteRef.current !== activeTrigger
    ) {
      onSkillTrigger?.();
    }

    lastTriggeredAutocompleteRef.current = activeTrigger;
  }, [
    autocompleteRange,
    isAutocompleteOpen,
    onSkillTrigger,
    text,
  ]);

  const applyAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      if (!autocompleteRange) {
        return;
      }
      const triggerIndex = Math.max(0, autocompleteRange.start - 1);
      const triggerChar = text[triggerIndex] ?? "";
      const cursor = selectionStart ?? autocompleteRange.end;
      const promptRange =
        triggerChar === "@" ? findPromptArgRangeAtCursor(text, cursor) : null;
      const shouldReplaceTriggerChar =
        triggerChar === "@" ||
        triggerChar === "$" ||
        (triggerChar === "/" && item.action !== "send");
      const before =
        shouldReplaceTriggerChar
          ? text.slice(0, triggerIndex)
          : text.slice(0, autocompleteRange.start);
      const after = text.slice(autocompleteRange.end);
      const insert = item.insertText ?? item.label;
      const actualInsert = insert;
      if (item.action === "send") {
        closeAutocomplete();
        onSendAutocompleteItem?.(item, actualInsert);
        return;
      }
      const needsSpace = promptRange
        ? false
        : after.length === 0
          ? true
          : !/^\s/.test(after);
      const nextText = `${before}${actualInsert}${needsSpace ? " " : ""}${after}`;
      setText(nextText);
      onItemApplied?.(item, { triggerChar, insertedText: actualInsert });
      closeAutocomplete();
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (!textarea) {
          return;
        }
        const insertCursor = Math.min(
          actualInsert.length,
          Math.max(0, item.cursorOffset ?? actualInsert.length),
        );
        const cursor =
          before.length +
          insertCursor +
          (item.cursorOffset === undefined ? (needsSpace ? 1 : 0) : 0);
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
        setSelectionStart(cursor);
      });
    },
    [
      autocompleteRange,
      closeAutocomplete,
      selectionStart,
      setSelectionStart,
      setText,
      text,
      textareaRef,
      onItemApplied,
      onSendAutocompleteItem,
    ],
  );

  const handleTextChange = useCallback(
    (next: string, cursor: number | null) => {
      setText(next);
      setSelectionStart(cursor);
    },
    [setSelectionStart, setText],
  );

  const handleSelectionChange = useCallback(
    (cursor: number | null) => {
      setSelectionStart(cursor);
    },
    [setSelectionStart],
  );

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      if (isComposingEvent(event)) {
        return;
      }
      if (isAutocompleteOpen) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveHighlight(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveHighlight(-1);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const selected =
            autocompleteMatches[highlightIndex] ?? autocompleteMatches[0];
          if (selected) {
            applyAutocomplete(selected);
          }
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const selected =
            autocompleteMatches[highlightIndex] ?? autocompleteMatches[0];
          if (selected) {
            applyAutocomplete(selected);
          }
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeAutocomplete();
          return;
        }
      }
      if (event.key === "Tab") {
        const cursor = selectionStart ?? text.length;
        const nextCursor = findNextPromptArgCursor(text, cursor);
        if (nextCursor !== null) {
          event.preventDefault();
          requestAnimationFrame(() => {
            const textarea = textareaRef.current;
            if (!textarea) {
              return;
            }
            textarea.focus();
            textarea.setSelectionRange(nextCursor, nextCursor);
            setSelectionStart(nextCursor);
          });
        }
      }
    },
    [
      applyAutocomplete,
      autocompleteMatches,
      closeAutocomplete,
      disabled,
      highlightIndex,
      isAutocompleteOpen,
      moveHighlight,
      selectionStart,
      setSelectionStart,
      text,
      textareaRef,
    ],
  );

  return {
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
  };
}
