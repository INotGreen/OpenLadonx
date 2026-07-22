import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { getCaretPosition } from "../../../utils/caretPosition";
import { CARET_ANCHOR_GAP } from "../components/workspaceHomeHelpers";

type UseWorkspaceHomeSuggestionsStyleParams = {
  isAutocompleteOpen: boolean;
  autocompleteAnchorIndex: number | null;
  selectionStart: number | null;
  prompt: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

export function useWorkspaceHomeSuggestionsStyle({
  isAutocompleteOpen,
  autocompleteAnchorIndex,
  selectionStart,
  prompt,
  textareaRef,
}: UseWorkspaceHomeSuggestionsStyleParams) {
  const [suggestionsStyle, setSuggestionsStyle] = useState<
    CSSProperties | undefined
  >(undefined);

  useLayoutEffect(() => {
    if (!isAutocompleteOpen) {
      setSuggestionsStyle(undefined);
      return;
    }
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const cursor =
      autocompleteAnchorIndex ??
      textarea.selectionStart ??
      selectionStart ??
      prompt.length;
    const caret = getCaretPosition(textarea, cursor);
    if (!caret) {
      return;
    }
    const textareaRect = textarea.getBoundingClientRect();
    const container = textarea.closest(".composer-input");
    const containerRect = container?.getBoundingClientRect();
    const offsetLeft = textareaRect.left - (containerRect?.left ?? 0);
    const offsetTop = textareaRect.top - (containerRect?.top ?? 0);
    const width = textarea.clientWidth || 0;
    setSuggestionsStyle({
      top: caret.top + caret.lineHeight + CARET_ANCHOR_GAP + offsetTop,
      left: offsetLeft,
      width: width > 0 ? `${width}px` : "auto",
      maxWidth: width > 0 ? `${width}px` : "none",
      bottom: "auto",
      right: "auto",
    });
  }, [
    autocompleteAnchorIndex,
    isAutocompleteOpen,
    prompt,
    selectionStart,
    textareaRef,
  ]);

  return suggestionsStyle;
}
