import { useCallback, useEffect, useState } from "react";

/** 存储键名 */
const STORAGE_KEY = "composerEditorExpanded";

/**
 * Composer 编辑器状态钩子
 * 管理编辑器的展开/折叠状态，并持久化到本地存储
 * @returns 编辑器状态和切换函数
 */
export function useComposerEditorState() {
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  // 持久化展开状态到本地存储
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(isExpanded));
    } catch {
      // Ignore storage failures.
    }
  }, [isExpanded]);

  /**
   * 切换展开状态
   */
  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return { isExpanded, toggleExpanded };
}
