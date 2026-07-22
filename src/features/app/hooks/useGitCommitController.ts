// Git提交控制器Hook
// 管理Git提交、推送、拉取、同步等操作的状态和逻辑
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { WorkspaceInfo } from "../../../types";
import {
  commitGit,
  generateCommitMessage,
  fetchGit,
  pullGit,
  pushGit,
  stageGitAll,
  syncGit,
} from "../../../services/tauri";
import { shouldApplyCommitMessage } from "../../../utils/commitMessage";
import { useGitStatus } from "../../git/hooks/useGitStatus";

type GitStatusState = ReturnType<typeof useGitStatus>["status"];

// Git提交控制器的选项类型
type GitCommitControllerOptions = {
  activeWorkspace: WorkspaceInfo | null; // 当前活动工作空间
  activeWorkspaceId: string | null; // 当前活动工作空间ID
  activeWorkspaceIdRef: RefObject<string | null>; // 工作空间ID的引用
  commitMessageModelId: string | null; // 生成提交消息使用的模型ID
  gitStatus: GitStatusState; // Git状态
  refreshGitStatus: () => void; // 刷新Git状态的函数
  refreshGitLog?: () => void; // 刷新Git日志的函数
};

// Git提交控制器的返回类型
type GitCommitController = {
  commitMessage: string; // 提交消息
  commitMessageLoading: boolean; // 生成提交消息的加载状态
  commitMessageError: string | null; // 生成提交消息的错误信息
  commitLoading: boolean; // 提交操作的加载状态
  pullLoading: boolean; // 拉取操作的加载状态
  fetchLoading: boolean; // 获取操作的加载状态
  pushLoading: boolean; // 推送操作的加载状态
  syncLoading: boolean; // 同步操作的加载状态
  commitError: string | null; // 提交操作的错误信息
  pullError: string | null; // 拉取操作的错误信息
  fetchError: string | null; // 获取操作的错误信息
  pushError: string | null; // 推送操作的错误信息
  syncError: string | null; // 同步操作的错误信息
  hasWorktreeChanges: boolean; // 是否有工作树变更
  onCommitMessageChange: (value: string) => void; // 处理提交消息变化的函数
  onGenerateCommitMessage: () => Promise<void>; // 生成提交消息的函数
  onCommit: () => Promise<void>; // 执行提交的函数
  onCommitAndPush: () => Promise<void>; // 执行提交并推送的函数
  onCommitAndSync: () => Promise<void>; // 执行提交并同步的函数
  onPull: () => Promise<void>; // 执行拉取的函数
  onFetch: () => Promise<void>; // 执行获取的函数
  onPush: () => Promise<void>; // 执行推送的函数
  onSync: () => Promise<void>; // 执行同步的函数
};

export function useGitCommitController({
  activeWorkspace,
  activeWorkspaceId,
  activeWorkspaceIdRef,
  commitMessageModelId,
  gitStatus,
  refreshGitStatus,
  refreshGitLog,
}: GitCommitControllerOptions): GitCommitController {
  // 各种加载和错误状态管理
  const [commitMessage, setCommitMessage] = useState("");
  const [commitMessageLoading, setCommitMessageLoading] = useState(false);
  const [commitMessageError, setCommitMessageError] = useState<string | null>(
    null,
  );
  const [commitLoading, setCommitLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // 计算是否有工作树变更（已暂存或未暂存的文件）
  const hasWorktreeChanges = useMemo(() => {
    const hasStagedChanges = gitStatus.stagedFiles.length > 0;
    const hasUnstagedChanges = gitStatus.unstagedFiles.length > 0;
    return hasStagedChanges || hasUnstagedChanges;
  }, [gitStatus.stagedFiles.length, gitStatus.unstagedFiles.length]);

  // 确保在提交前已暂存所有变更
  const ensureStagedForCommit = useCallback(async () => {
    const hasStagedChanges = gitStatus.stagedFiles.length > 0;
    const hasUnstagedChanges = gitStatus.unstagedFiles.length > 0;
    if (!activeWorkspace || hasStagedChanges || !hasUnstagedChanges) {
      return;
    }
    await stageGitAll(activeWorkspace.id);
  }, [activeWorkspace, gitStatus.stagedFiles.length, gitStatus.unstagedFiles.length]);

  // 处理提交消息文本变化
  const handleCommitMessageChange = useCallback((value: string) => {
    setCommitMessage(value);
  }, []);

  // 处理生成提交消息
  const handleGenerateCommitMessage = useCallback(async () => {
    if (!activeWorkspace || commitMessageLoading) {
      return;
    }
    const workspaceId = activeWorkspace.id;
    setCommitMessageLoading(true);
    setCommitMessageError(null);
    try {
      // 调用后端生成提交消息
      const message = await generateCommitMessage(workspaceId, commitMessageModelId);
      // 检查工作空间是否已切换，避免应用错误的消息
      if (!shouldApplyCommitMessage(activeWorkspaceIdRef.current, workspaceId)) {
        return;
      }
      setCommitMessage(message);
    } catch (error) {
      // 错误处理中也要检查工作空间是否已切换
      if (!shouldApplyCommitMessage(activeWorkspaceIdRef.current, workspaceId)) {
        return;
      }
      setCommitMessageError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      // 只有在工作空间未切换时才清除加载状态
      if (shouldApplyCommitMessage(activeWorkspaceIdRef.current, workspaceId)) {
        setCommitMessageLoading(false);
      }
    }
  }, [activeWorkspace, commitMessageLoading, activeWorkspaceIdRef, commitMessageModelId]);

  // 当工作空间切换时重置提交消息状态
  useEffect(() => {
    setCommitMessage("");
    setCommitMessageError(null);
    setCommitMessageLoading(false);
  }, [activeWorkspaceId]);

  // 处理提交操作
  const handleCommit = useCallback(async () => {
    if (
      !activeWorkspace ||
      commitLoading ||
      !commitMessage.trim() ||
      !hasWorktreeChanges
    ) {
      return;
    }
    setCommitLoading(true);
    setCommitError(null);
    try {
      await ensureStagedForCommit();
      await commitGit(activeWorkspace.id, commitMessage.trim());
      setCommitMessage("");
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      setCommitError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitLoading(false);
    }
  }, [
    activeWorkspace,
    commitLoading,
    commitMessage,
    ensureStagedForCommit,
    hasWorktreeChanges,
    refreshGitLog,
    refreshGitStatus,
  ]);

  // 处理提交并推送操作
  const handleCommitAndPush = useCallback(async () => {
    if (
      !activeWorkspace ||
      commitLoading ||
      pushLoading ||
      !commitMessage.trim() ||
      !hasWorktreeChanges
    ) {
      return;
    }
    let commitSucceeded = false;
    setCommitLoading(true);
    setPushLoading(true);
    setCommitError(null);
    setPushError(null);
    try {
      await ensureStagedForCommit();
      await commitGit(activeWorkspace.id, commitMessage.trim());
      commitSucceeded = true;
      setCommitMessage("");
      setCommitLoading(false);
      await pushGit(activeWorkspace.id);
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // 根据提交是否成功来设置相应的错误信息
      if (!commitSucceeded) {
        setCommitError(errorMsg);
      } else {
        setPushError(errorMsg);
      }
    } finally {
      setCommitLoading(false);
      setPushLoading(false);
    }
  }, [
    activeWorkspace,
    commitLoading,
    pushLoading,
    commitMessage,
    ensureStagedForCommit,
    hasWorktreeChanges,
    refreshGitLog,
    refreshGitStatus,
  ]);

  // 处理提交并同步操作
  const handleCommitAndSync = useCallback(async () => {
    if (
      !activeWorkspace ||
      commitLoading ||
      syncLoading ||
      !commitMessage.trim() ||
      !hasWorktreeChanges
    ) {
      return;
    }
    let commitSucceeded = false;
    setCommitLoading(true);
    setSyncLoading(true);
    setCommitError(null);
    setSyncError(null);
    try {
      await ensureStagedForCommit();
      await commitGit(activeWorkspace.id, commitMessage.trim());
      commitSucceeded = true;
      setCommitMessage("");
      setCommitLoading(false);
      await syncGit(activeWorkspace.id);
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // 根据提交是否成功来设置相应的错误信息
      if (!commitSucceeded) {
        setCommitError(errorMsg);
      } else {
        setSyncError(errorMsg);
      }
    } finally {
      setCommitLoading(false);
      setSyncLoading(false);
    }
  }, [
    activeWorkspace,
    commitLoading,
    syncLoading,
    commitMessage,
    ensureStagedForCommit,
    hasWorktreeChanges,
    refreshGitLog,
    refreshGitStatus,
  ]);

  const handlePull = useCallback(async () => {
    if (!activeWorkspace || pullLoading) {
      return;
    }
    setPullLoading(true);
    setPullError(null);
    try {
      await pullGit(activeWorkspace.id);
      setPushError(null);
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      setPullError(error instanceof Error ? error.message : String(error));
    } finally {
      setPullLoading(false);
    }
  }, [activeWorkspace, pullLoading, refreshGitLog, refreshGitStatus]);

  const handlePush = useCallback(async () => {
    if (!activeWorkspace || pushLoading) {
      return;
    }
    setPushLoading(true);
    setPushError(null);
    try {
      await pushGit(activeWorkspace.id);
      setPullError(null);
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      setPushError(error instanceof Error ? error.message : String(error));
    } finally {
      setPushLoading(false);
    }
  }, [activeWorkspace, pushLoading, refreshGitLog, refreshGitStatus]);

  const handleFetch = useCallback(async () => {
    if (!activeWorkspace || fetchLoading) {
      return;
    }
    setFetchLoading(true);
    setFetchError(null);
    try {
      await fetchGit(activeWorkspace.id);
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : String(error));
    } finally {
      setFetchLoading(false);
    }
  }, [activeWorkspace, fetchLoading, refreshGitLog, refreshGitStatus]);

  const handleSync = useCallback(async () => {
    if (!activeWorkspace || syncLoading) {
      return;
    }
    setSyncLoading(true);
    setSyncError(null);
    try {
      await syncGit(activeWorkspace.id);
      setPullError(null);
      setPushError(null);
      setSyncError(null);
      refreshGitStatus();
      refreshGitLog?.();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncLoading(false);
    }
  }, [activeWorkspace, refreshGitLog, refreshGitStatus, syncLoading]);

  return {
    commitMessage,
    commitMessageLoading,
    commitMessageError,
    commitLoading,
    pullLoading,
    fetchLoading,
    pushLoading,
    syncLoading,
    commitError,
    pullError,
    fetchError,
    pushError,
    syncError,
    hasWorktreeChanges,
    onCommitMessageChange: handleCommitMessageChange,
    onGenerateCommitMessage: handleGenerateCommitMessage,
    onCommit: handleCommit,
    onCommitAndPush: handleCommitAndPush,
    onCommitAndSync: handleCommitAndSync,
    onPull: handlePull,
    onFetch: handleFetch,
    onPush: handlePush,
    onSync: handleSync,
  };
}
