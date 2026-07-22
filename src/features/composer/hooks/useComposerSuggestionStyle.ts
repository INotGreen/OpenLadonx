import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { getCaretPosition } from "../../../utils/caretPosition";

/** 光标锚点间距 */
const CARET_ANCHOR_GAP = 8;

/**
 * Composer 建议样式钩子参数
 */
type UseComposerSuggestionStyleArgs = {
  /** 是否自动完成打开 */
  isAutocompleteOpen: boolean;
  /** 自动完成锚点索引 */
  autocompleteAnchorIndex: number | null;
  /** 选择起始位置 */
  selectionStart: number | null;
  /** 文本内容 */
  text: string;
  /** 文本区域引用 */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * Composer 建议样式钩子
 * 计算和管理建议弹出框的位置和样式
 */
export function useComposerSuggestionStyle({
  isAutocompleteOpen,
  autocompleteAnchorIndex,
  selectionStart,
  text,
  textareaRef,
}: UseComposerSuggestionStyleArgs) {
  const [suggestionsStyle, setSuggestionsStyle] = useState<CSSProperties | undefined>(
    undefined,
  );

  useLayoutEffect(() => {
    if (!isAutocompleteOpen) {
      setSuggestionsStyle(undefined);
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const cursor = autocompleteAnchorIndex ?? textarea.selectionStart ?? selectionStart ?? text.length;
    const caret = getCaretPosition(textarea, cursor);
    if (!caret) {
      return;
    }
    const container = textarea.closest(".composer-input-area");
    const containerWidth = container?.clientWidth ?? textarea.clientWidth ?? 0;
    setSuggestionsStyle({
      left: 0,
      right: 0,
      width: containerWidth > 0 ? `${containerWidth}px` : "auto",
      maxWidth: containerWidth > 0 ? `${containerWidth}px` : "none",
      bottom: `calc(100% + ${CARET_ANCHOR_GAP}px)`,
      top: "auto",
    });
  }, [autocompleteAnchorIndex, isAutocompleteOpen, selectionStart, text, textareaRef]);

  return suggestionsStyle;
}
