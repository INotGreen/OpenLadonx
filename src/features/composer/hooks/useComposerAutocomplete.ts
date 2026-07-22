import { useEffect, useMemo, useState } from "react";

/**
 * 自动完成项类型
 */
export type AutocompleteItem = {
  /** 唯一标识 */
  id: string;
  /** 显示标签 */
  label: string;
  /** 国际化显示标题（优先于 label 作为标题展示，不影响匹配/插入） */
  displayTitle?: string;
  /** 描述文本 */
  description?: string;
  /** 要插入的文本 */
  insertText?: string;
  /** 提示文本 */
  hint?: string;
  /** 光标偏移量 */
  cursorOffset?: number;
  /** 分组类型 */
  group?: "Files" | "Skills" | "Plugins" | "Apps" | "Slash" | "Prompts";
  /** 提及路径 */
  mentionPath?: string;
  /** 技能完整路径 */
  skillPath?: string;
  /** 插件完整路径 */
  pluginPath?: string;
  /** 插件图标 */
  iconDataUrl?: string;
  /** 插件品牌色 */
  brandColor?: string;
  /** 自动完成动作 */
  action?: "insert" | "send";
};

/**
 * 自动完成触发器类型
 */
export type AutocompleteTrigger = {
  /** 触发字符 */
  trigger: string;
  /** 触发器对应的项目列表 */
  items: AutocompleteItem[];
};

/**
 * 自动完成范围类型
 */
type AutocompleteRange = {
  /** 开始位置 */
  start: number;
  /** 结束位置 */
  end: number;
};

/**
 * 自动完成状态类型
 */
type AutocompleteState = {
  /** 是否激活 */
  active: boolean;
  /** 触发器 */
  trigger: string | null;
  /** 查询字符串 */
  query: string;
  /** 范围 */
  range: AutocompleteRange | null;
};

/**
 * Composer 自动完成钩子参数
 */
type UseComposerAutocompleteArgs = {
  /** 文本内容 */
  text: string;
  /** 光标位置 */
  selectionStart: number | null;
  /** 触发器列表 */
  triggers: AutocompleteTrigger[];
  /** 最大结果数量 */
  maxResults?: number;
};

/** 空白字符正则表达式 */
const whitespaceRegex = /\s/;
/** 触发器前缀正则表达式 */
const triggerPrefixRegex = /^(?:\s|["'`]|\(|\[|\{)$/;
const fileTriggerRegex = /(?:^|[\s"'`([{])@(?:'([^'\n]*)|([^\s"'`)\]}]*))$/;

function resolveFileAutocompleteState(text: string, cursor: number): AutocompleteState {
  const beforeCursor = text.slice(0, cursor);
  const match = fileTriggerRegex.exec(beforeCursor);
  if (!match) {
    return { active: false, trigger: null, query: "", range: null };
  }
  const query = match[1] ?? match[2] ?? "";
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex < 0) {
    return { active: false, trigger: null, query: "", range: null };
  }
  return {
    active: true,
    trigger: "@",
    query,
    range: {
      start: atIndex + 1,
      end: cursor,
    },
  };
}

/**
 * 解析自动完成状态
 * @param text - 文本内容
 * @param cursor - 光标位置
 * @param triggers - 触发器列表
 * @returns 自动完成状态
 */
function resolveAutocompleteState(
  text: string,
  cursor: number,
  triggers: AutocompleteTrigger[],
): AutocompleteState {
  if (cursor <= 0) {
    return { active: false, trigger: null, query: "", range: null };
  }
  const triggerSet = new Set(triggers.map((entry) => entry.trigger));
  if (triggerSet.has("@")) {
    const fileState = resolveFileAutocompleteState(text, cursor);
    if (fileState.active) {
      return fileState;
    }
  }
  let index = cursor - 1;
  while (index >= 0) {
    const char = text[index];
    if (whitespaceRegex.test(char)) {
      break;
    }
    if (triggerSet.has(char)) {
      const prevChar = index > 0 ? text[index - 1] : "";
      if (!prevChar || triggerPrefixRegex.test(prevChar)) {
        const query = text.slice(index + 1, cursor);
        return {
          active: true,
          trigger: char,
          query,
          range: { start: index + 1, end: cursor },
        };
      }
    }
    index -= 1;
  }
  return { active: false, trigger: null, query: "", range: null };
}

function basename(label: string) {
  const normalized = label.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : label;
}

function fileParts(label: string) {
  const normalized = label.replace(/\\/g, "/").toLowerCase();
  const base = basename(normalized);
  const dotIndex = base.lastIndexOf(".");
  const name =
    dotIndex > 0 && dotIndex < base.length - 1 ? base.slice(0, dotIndex) : base;
  const ext =
    dotIndex > 0 && dotIndex < base.length - 1 ? base.slice(dotIndex + 1) : "";
  return { normalized, base, name, ext };
}

function isSubsequence(query: string, target: string) {
  let q = 0;
  let t = 0;
  while (q < query.length && t < target.length) {
    if (query[q] === target[t]) {
      q += 1;
    }
    t += 1;
  }
  return q === query.length;
}

function scoreMatch(query: string, label: string) {
  if (!query) {
    return 0;
  }
  const normalizedQuery = query.toLowerCase();
  const { normalized, base, name, ext } = fileParts(label);
  const queryParts = normalizedQuery.split(".");
  const queryName = queryParts[0] ?? "";
  const queryExt = queryParts.length > 1 ? queryParts.slice(1).join(".") : "";
  const matchExt =
    !queryExt || ext.startsWith(queryExt) || ext.includes(queryExt);
  if (!matchExt) {
    return 0;
  }

  if (!queryName) {
    if (queryExt && ext === queryExt) {
      return 60;
    }
    if (queryExt) {
      return 40;
    }
    return 0;
  }

  if (normalized === normalizedQuery || name === queryName) {
    return 110;
  }
  if (name.startsWith(queryName)) {
    return 95 + (queryExt ? 10 : 0);
  }
  if (base.startsWith(queryName)) {
    return 90 + (queryExt ? 10 : 0);
  }
  if (normalized.startsWith(queryName)) {
    return 80 + (queryExt ? 5 : 0);
  }
  if (name.includes(queryName)) {
    return 70 + (queryExt ? 5 : 0);
  }
  if (normalized.includes(queryName)) {
    return 60 + (queryExt ? 5 : 0);
  }
  if (isSubsequence(queryName, name)) {
    return 50 + (queryExt ? 5 : 0);
  }
  return 0;
}

function rankItems(items: AutocompleteItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items.slice();
  }
  const ranked = items
    .map((item) => ({
      item,
      score: scoreMatch(normalized, item.label),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.item.label.localeCompare(b.item.label);
    });
  return ranked.map((entry) => entry.item);
}

export function useComposerAutocomplete({
  text,
  selectionStart,
  triggers,
  maxResults = 50,
}: UseComposerAutocompleteArgs) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const state = useMemo(() => {
    if (selectionStart === null || selectionStart < 0) {
      return { active: false, trigger: null, query: "", range: null };
    }
    return resolveAutocompleteState(text, selectionStart, triggers);
  }, [selectionStart, text, triggers]);

  const matches = useMemo(() => {
    if (!state.active || !state.trigger) {
      return [];
    }
    const source = triggers.find((entry) => entry.trigger === state.trigger);
    if (!source) {
      return [];
    }
    const ranked = rankItems(source.items, state.query);
    return ranked.slice(0, Math.max(0, maxResults));
  }, [state.active, state.query, state.trigger, triggers, maxResults]);

  useEffect(() => {
    setHighlightIndex(0);
    setDismissed(false);
  }, [state.active, state.query, state.trigger, state.range?.start, state.range?.end]);

  const moveHighlight = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    setHighlightIndex((prev) => {
      const next = (prev + delta + matches.length) % matches.length;
      return next;
    });
  };

  const close = () => {
    setHighlightIndex(0);
    setDismissed(true);
  };

  return {
    active: state.active && matches.length > 0 && !dismissed,
    query: state.query,
    range: state.range,
    matches,
    highlightIndex,
    setHighlightIndex,
    moveHighlight,
    close,
  };
}
