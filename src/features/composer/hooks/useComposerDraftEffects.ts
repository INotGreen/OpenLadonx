import { useEffect, type RefObject } from "react";
import type { AppMention, DictationTranscript, QueuedMessage } from "../../../types";
import { computeDictationInsertion } from "../../../utils/dictation";
import type { AppMentionBinding } from "../../apps/utils/appMentions";

/**
 * Composer 草稿效果钩子参数
 */
type UseComposerDraftEffectsArgs = {
  /** 草稿文本 */
  draftText: string;
  /** 历史记录键 */
  historyKey: string | null;
  /** 预填充草稿消息 */
  prefillDraft: QueuedMessage | null;
  /** 预填充处理完成回调 */
  onPrefillHandled?: (id: string) => void;
  /** 要插入的文本消息 */
  insertText: QueuedMessage | null;
  /** 插入处理完成回调 */
  onInsertHandled?: (id: string) => void;
  /** 听写转录文本 */
  dictationTranscript: DictationTranscript | null;
  /** 听写转录处理完成回调 */
  onDictationTranscriptHandled?: (id: string) => void;
  /** 文本区域引用 */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 选择起始位置 */
  selectionStart: number | null;
  /** 同步草稿文本回调 */
  syncDraftText: (next: string) => void;
  /** 当前文本 */
  text: string;
  /** 设置编辑器文本回调 */
  setComposerText: (next: string) => void;
  /** 设置应用提及绑定回调 */
  setAppMentionBindings: (next: AppMentionBinding[]) => void;
  /** 从提及创建绑定回调 */
  bindingsFromMentions: (mentions?: AppMention[]) => AppMentionBinding[];
  /** 重置历史导航回调 */
  resetHistoryNavigation: () => void;
  /** 处理选择变更回调 */
  handleSelectionChange: (cursor: number | null) => void;
};

/**
 * 应用队列消息到编辑器
 * @param message - 队列消息
 * @param handled - 处理完成回调
 * @param setComposerText - 设置编辑器文本回调
 * @param setAppMentionBindings - 设置应用提及绑定回调
 * @param bindingsFromMentions - 从提及创建绑定回调
 * @param resetHistoryNavigation - 重置历史导航回调
 */
function applyQueuedMessage({
  message,
  handled,
  setComposerText,
  setAppMentionBindings,
  bindingsFromMentions,
  resetHistoryNavigation,
}: {
  message: QueuedMessage;
  handled?: (id: string) => void;
  setComposerText: (next: string) => void;
  setAppMentionBindings: (next: AppMentionBinding[]) => void;
  bindingsFromMentions: (mentions?: AppMention[]) => AppMentionBinding[];
  resetHistoryNavigation: () => void;
}) {
  setComposerText(message.text);
  setAppMentionBindings(bindingsFromMentions(message.appMentions));
  resetHistoryNavigation();
  handled?.(message.id);
}

export function useComposerDraftEffects({
  draftText,
  historyKey,
  prefillDraft,
  onPrefillHandled,
  insertText,
  onInsertHandled,
  dictationTranscript,
  onDictationTranscriptHandled,
  textareaRef,
  selectionStart,
  syncDraftText,
  text,
  setComposerText,
  setAppMentionBindings,
  bindingsFromMentions,
  resetHistoryNavigation,
  handleSelectionChange,
}: UseComposerDraftEffectsArgs) {
  useEffect(() => {
    syncDraftText(draftText);
  }, [draftText, syncDraftText]);

  useEffect(() => {
    setAppMentionBindings([]);
  }, [historyKey, setAppMentionBindings]);

  useEffect(() => {
    if (!prefillDraft) {
      return;
    }
    applyQueuedMessage({
      message: prefillDraft,
      handled: onPrefillHandled,
      setComposerText,
      setAppMentionBindings,
      bindingsFromMentions,
      resetHistoryNavigation,
    });
  }, [
    bindingsFromMentions,
    onPrefillHandled,
    prefillDraft,
    resetHistoryNavigation,
    setAppMentionBindings,
    setComposerText,
  ]);

  useEffect(() => {
    if (!insertText) {
      return;
    }
    applyQueuedMessage({
      message: insertText,
      handled: onInsertHandled,
      setComposerText,
      setAppMentionBindings,
      bindingsFromMentions,
      resetHistoryNavigation,
    });
  }, [
    bindingsFromMentions,
    insertText,
    onInsertHandled,
    resetHistoryNavigation,
    setAppMentionBindings,
    setComposerText,
  ]);

  useEffect(() => {
    if (!dictationTranscript) {
      return;
    }
    const textToInsert = dictationTranscript.text.trim();
    if (!textToInsert) {
      onDictationTranscriptHandled?.(dictationTranscript.id);
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? selectionStart ?? text.length;
    const end = textarea?.selectionEnd ?? start;
    const { nextText, nextCursor } = computeDictationInsertion(
      text,
      textToInsert,
      start,
      end,
    );
    setComposerText(nextText);
    resetHistoryNavigation();
    requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(nextCursor, nextCursor);
      handleSelectionChange(nextCursor);
    });
    onDictationTranscriptHandled?.(dictationTranscript.id);
  }, [
    dictationTranscript,
    handleSelectionChange,
    onDictationTranscriptHandled,
    resetHistoryNavigation,
    selectionStart,
    setComposerText,
    text,
    textareaRef,
  ]);
}
