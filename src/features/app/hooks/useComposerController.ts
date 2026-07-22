import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccessMode,
  AppMention,
  ComposerSendIntent,
  FollowUpMessageBehavior,
  QueuedMessage,
  SendMessageResult,
  WorkspaceInfo,
} from "../../../types";
import { useComposerImages } from "../../composer/hooks/useComposerImages";
import { useQueuedSend } from "../../threads/hooks/useQueuedSend";

const COMPOSER_DRAFT_STORAGE_PREFIX = "ladonx:composer-draft";

function composerDraftStorageKey(workspaceId: string | null, threadId: string | null) {
  if (!workspaceId || !threadId) {
    return null;
  }
  return `${COMPOSER_DRAFT_STORAGE_PREFIX}:${workspaceId}:${threadId}`;
}

function readStoredComposerDraft(workspaceId: string | null, threadId: string | null) {
  const key = composerDraftStorageKey(workspaceId, threadId);
  if (!key || typeof window === "undefined") {
    return "";
  }
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStoredComposerDraft(workspaceId: string | null, threadId: string | null, value: string) {
  const key = composerDraftStorageKey(workspaceId, threadId);
  if (!key || typeof window === "undefined") {
    return;
  }
  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Best-effort fallback for Windows WebView lifecycle resets.
  }
}

export function useComposerController({
  activeThreadId, // 当前活动线程ID
  activeTurnId, // 当前活动轮次ID
  activeWorkspaceId, // 当前活动工作空间ID
  activeWorkspace, // 当前活动工作空间对象
  isProcessing, // 是否正在处理
  isReviewing, // 是否正在审查
  queueFlushPaused = false, // 队列刷新是否暂停
  steerEnabled, // 是否启用引导功能
  followUpMessageBehavior, // 后续消息行为
  appsEnabled, // 是否启用应用
  connectWorkspace, // 连接工作空间的函数
  startThreadForWorkspace, // 为工作空间启动线程的函数
  accessMode, // 当前访问模式
  sendUserMessage, // 发送用户消息的函数
  sendUserMessageToThread, // 向线程发送用户消息的函数
  startFork, // 启动分支的函数
  startReview, // 启动审查的函数
  startResume, // 启动恢复的函数
  startCompact, // 启动压缩的函数
  startApps, // 启动应用的函数
  startMcp, // 启动MCP的函数
  startFast, // 启动快速模式的函数
  startStatus, // 启动状态检查的函数
}: {
  activeThreadId: string | null;
  activeTurnId: string | null;
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  isProcessing: boolean;
  isReviewing: boolean;
  queueFlushPaused?: boolean;
  steerEnabled: boolean;
  followUpMessageBehavior: FollowUpMessageBehavior;
  appsEnabled: boolean;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean; accessMode?: AccessMode | null },
  ) => Promise<string | null>;
  accessMode: AccessMode;
  sendUserMessage: (
    text: string,
    images?: string[],
    appMentions?: AppMention[],
    options?: { sendIntent?: ComposerSendIntent },
  ) => Promise<{ status: "sent" | "blocked" | "steer_failed" }>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
  ) => Promise<void | SendMessageResult>;
  startFork: (text: string) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startApps: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
}) {
  // Drafts are kept in a ref so typing doesn't trigger a re-render of the
  // entire app. activeDraft state is updated only on thread switch.
  const composerDraftsByThreadRef = useRef<Record<string, string>>({});
  const [activeDraft, setActiveDraft] = useState("");

  useEffect(() => {
    if (!activeThreadId) {
      setActiveDraft("");
      return;
    }
    const draft =
      composerDraftsByThreadRef.current[activeThreadId] ??
      readStoredComposerDraft(activeWorkspaceId, activeThreadId);
    composerDraftsByThreadRef.current[activeThreadId] = draft;
    setActiveDraft(draft);
  }, [activeThreadId, activeWorkspaceId]);

  // 预填充草稿状态，用于编辑队列消息
  const [prefillDraft, setPrefillDraft] = useState<QueuedMessage | null>(null);

  // 插入文本状态，用于插入文件内容到编辑器
  const [composerInsert, setComposerInsert] = useState<QueuedMessage | null>(
    null,
  );

  // 图片附件管理
  const {
    activeImages, // 当前活动的图片
    attachImages, // 附加图片
    pickImages, // 选择图片
    removeImage, // 移除图片
    clearActiveImages, // 清除活动图片
    setImagesForThread, // 为线程设置图片
    removeImagesForThread, // 为线程移除图片
  } = useComposerImages({ activeThreadId, activeWorkspaceId });

  // 消息队列发送管理
  const {
    activeQueue, // 活动消息队列
    handleSend, // 处理发送
    queueMessage, // 队列消息
    removeQueuedMessage, // 移除队列消息
  } = useQueuedSend({
    activeThreadId,
    activeTurnId,
    isProcessing,
    isReviewing,
    queueFlushPaused,
    steerEnabled,
    followUpMessageBehavior,
    appsEnabled,
    activeWorkspace,
    connectWorkspace,
    startThreadForWorkspace,
    accessMode,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startCompact,
    startApps,
    startMcp,
    startFast,
    startStatus,
    clearActiveImages,
  });

  // 处理草稿文本变化
  const handleDraftChange = useCallback(
    (next: string) => {
      if (!activeThreadId) {
        return;
      }
      composerDraftsByThreadRef.current[activeThreadId] = next;
      writeStoredComposerDraft(activeWorkspaceId, activeThreadId, next);
    },
    [activeThreadId, activeWorkspaceId],
  );

  // Live read of the active draft — use this when you need the current value
  // at the time of an action (e.g. file drop, skill insert). The state version
  // only updates on thread switch to avoid re-rendering the app on each keystroke.
  const getActiveDraft = useCallback(() => {
    if (!activeThreadId) {
      return "";
    }
    return (
      composerDraftsByThreadRef.current[activeThreadId] ??
      readStoredComposerDraft(activeWorkspaceId, activeThreadId)
    );
  }, [activeThreadId, activeWorkspaceId]);

  // 处理发送提示词
  const handleSendPrompt = useCallback(
    (text: string, appMentions?: AppMention[]) => {
      if (!text.trim()) {
        return;
      }
      void handleSend(text, [], appMentions);
    },
    [handleSend],
  );

  // 处理编辑队列消息
  const handleEditQueued = useCallback(
    (item: QueuedMessage) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, item.id);
      setImagesForThread(activeThreadId, item.images ?? []);
      setPrefillDraft(item);
    },
    [activeThreadId, removeQueuedMessage, setImagesForThread],
  );

  // 处理删除队列消息
  const handleDeleteQueued = useCallback(
    (id: string) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, id);
    },
    [activeThreadId, removeQueuedMessage],
  );

  const handleSendQueuedNow = useCallback(
    async (item: QueuedMessage) => {
      if (!activeThreadId) {
        return;
      }
      removeQueuedMessage(activeThreadId, item.id);
      await handleSend(
        item.text,
        item.images ?? [],
        item.appMentions ?? [],
        "steer",
      );
    },
    [activeThreadId, handleSend, removeQueuedMessage],
  );

  // 清除特定线程的草稿
  const clearDraftForThread = useCallback((threadId: string) => {
    if (!(threadId in composerDraftsByThreadRef.current)) {
      writeStoredComposerDraft(activeWorkspaceId, threadId, "");
      return;
    }
    const { [threadId]: _, ...rest } = composerDraftsByThreadRef.current;
    composerDraftsByThreadRef.current = rest;
    writeStoredComposerDraft(activeWorkspaceId, threadId, "");
    if (threadId === activeThreadId) {
      setActiveDraft("");
    }
  }, [activeThreadId, activeWorkspaceId]);

  // 返回编辑器控制器的所有状态和操作函数
  return {
    activeImages, // 当前活动的图片
    attachImages, // 附加图片函数
    pickImages, // 选择图片函数
    removeImage, // 移除图片函数
    clearActiveImages, // 清除活动图片函数
    setImagesForThread, // 为线程设置图片函数
    removeImagesForThread, // 为线程移除图片函数
    activeQueue, // 活动消息队列
    handleSend, // 处理发送函数
    queueMessage, // 队列消息函数
    removeQueuedMessage, // 移除队列消息函数
    prefillDraft, // 预填充草稿
    setPrefillDraft, // 设置预填充草稿函数
    composerInsert, // 编辑器插入文本
    setComposerInsert, // 设置编辑器插入文本函数
    activeDraft, // 当前活动草稿
    getActiveDraft, // 实时读取当前活动草稿
    handleDraftChange, // 处理草稿变化函数
    handleSendPrompt, // 处理发送提示词函数
    handleEditQueued, // 处理编辑队列消息函数
    handleDeleteQueued, // 处理删除队列消息函数
    handleSendQueuedNow,
    clearDraftForThread, // 清除线程草稿函数
  };
}
