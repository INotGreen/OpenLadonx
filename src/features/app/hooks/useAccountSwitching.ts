import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cancelCodexLogin, runCodexLogin } from "../../../services/tauri";
import { subscribeAppServerEvents } from "../../../services/events";
import type { AccountSnapshot } from "../../../types";
import { getAppServerParams, getAppServerRawMethod } from "../../../utils/appServerEvents";
import { openUrl } from "@tauri-apps/plugin-opener";

// 账户切换功能的参数类型定义
type UseAccountSwitchingArgs = {
  activeWorkspaceId: string | null; // 当前活动的工作空间ID
  accountByWorkspace: Record<string, AccountSnapshot | null | undefined>; // 按工作空间索引的账户信息
  refreshAccountInfo: (workspaceId: string) => Promise<void> | void; // 刷新账户信息的函数
  refreshAccountRateLimits: (workspaceId: string) => Promise<void> | void; // 刷新账户速率限制的函数
  alertError: (error: unknown) => void; // 显示错误提示的函数
};

type UseAccountSwitchingResult = {
  activeAccount: AccountSnapshot | null;
  accountSwitching: boolean;
  handleSwitchAccount: () => Promise<void>;
  handleCancelSwitchAccount: () => Promise<void>;
};

export function useAccountSwitching({
  activeWorkspaceId,
  accountByWorkspace,
  refreshAccountInfo,
  refreshAccountRateLimits,
  alertError,
}: UseAccountSwitchingArgs): UseAccountSwitchingResult {
  // 账户切换状态管理
  const [accountSwitching, setAccountSwitching] = useState(false);
  const accountSwitchCanceledRef = useRef(false); // 用户是否取消了账户切换
  const loginIdRef = useRef<string | null>(null); // 当前登录操作的ID
  const loginWorkspaceIdRef = useRef<string | null>(null); // 正在登录的工作空间ID
  const accountSwitchingRef = useRef(false); // 账户切换状态的引用
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId); // 当前活动工作空间ID的引用
  const refreshAccountInfoRef = useRef(refreshAccountInfo); // 刷新账户信息函数的引用
  const refreshAccountRateLimitsRef = useRef(refreshAccountRateLimits); // 刷新速率限制函数的引用
  const alertErrorRef = useRef(alertError); // 错误提示函数的引用

  // 计算当前活动的账户
  const activeAccount = useMemo(() => {
    if (!activeWorkspaceId) {
      return null;
    }
    return accountByWorkspace[activeWorkspaceId] ?? null;
  }, [activeWorkspaceId, accountByWorkspace]);

  // 检查Codex登录是否被用户取消
  const isCodexLoginCanceled = useCallback((error: unknown) => {
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "";
    const normalized = message.toLowerCase();
    return (
      normalized.includes("codex login canceled") ||
      normalized.includes("codex login cancelled") ||
      normalized.includes("request canceled")
    );
  }, []);

  // 保持refs与最新状态同步
  useEffect(() => {
    accountSwitchingRef.current = accountSwitching;
  }, [accountSwitching]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    refreshAccountInfoRef.current = refreshAccountInfo;
  }, [refreshAccountInfo]);

  useEffect(() => {
    refreshAccountRateLimitsRef.current = refreshAccountRateLimits;
  }, [refreshAccountRateLimits]);

  useEffect(() => {
    alertErrorRef.current = alertError;
  }, [alertError]);

  // 监听工作空间切换，如果用户在登录过程中切换了工作空间，清除切换状态
  useEffect(() => {
    const currentWorkspaceId = activeWorkspaceId;
    const inFlightWorkspaceId = loginWorkspaceIdRef.current;
    if (
      accountSwitchingRef.current &&
      inFlightWorkspaceId &&
      currentWorkspaceId &&
      inFlightWorkspaceId !== currentWorkspaceId
    ) {
      // 用户离开了发起登录的工作空间
      // 继续追踪正在进行的登录，但清除切换状态指示器
      setAccountSwitching(false);
    }
  }, [activeWorkspaceId]);

  // 监听应用服务器事件，处理账户登录完成和账户更新事件
  useEffect(() => {
    const unlisten = subscribeAppServerEvents((payload) => {
      // 匹配工作空间ID（优先使用正在登录的工作空间ID）
      const matchWorkspaceId = loginWorkspaceIdRef.current ?? activeWorkspaceIdRef.current;
      if (!matchWorkspaceId || payload.workspace_id !== matchWorkspaceId) {
        return;
      }

      const method = getAppServerRawMethod(payload);
      if (!method) {
        return;
      }
      const params = getAppServerParams(payload);

      // 处理登录完成事件
      if (method === "account/login/completed") {
        const loginId = String(params.loginId ?? params.login_id ?? "");
        // 确保处理的是正确的登录请求
        if (loginIdRef.current && loginId && loginIdRef.current !== loginId) {
          return;
        }

        // 清理登录状态
        loginIdRef.current = null;
        loginWorkspaceIdRef.current = null;
        const success = Boolean(params.success);
        const errorMessage = String(params.error ?? "").trim();

        // 登录成功时刷新账户信息
        if (success && !accountSwitchCanceledRef.current) {
          void refreshAccountInfoRef.current(matchWorkspaceId);
          void refreshAccountRateLimitsRef.current(matchWorkspaceId);
        } else if (!accountSwitchCanceledRef.current && errorMessage) {
          // 登录失败时显示错误信息
          alertErrorRef.current(errorMessage);
        }

        setAccountSwitching(false);
        accountSwitchCanceledRef.current = false;
        return;
      }

      // 处理账户更新事件
      if (method === "account/updated") {
        if (!accountSwitchingRef.current || accountSwitchCanceledRef.current) {
          return;
        }
        void refreshAccountInfoRef.current(matchWorkspaceId);
        void refreshAccountRateLimitsRef.current(matchWorkspaceId);
        setAccountSwitching(false);
        accountSwitchCanceledRef.current = false;
      }
    });

    return () => {
      unlisten();
    };
  }, []);

  // 处理账户切换操作
  const handleSwitchAccount = useCallback(async () => {
    if (!activeWorkspaceId || accountSwitching) {
      return;
    }
    const workspaceId = activeWorkspaceId;
    accountSwitchCanceledRef.current = false;
    setAccountSwitching(true);
    loginIdRef.current = null;
    loginWorkspaceIdRef.current = workspaceId;
    try {
      // 调用Codex登录命令
      const { loginId, authUrl } = await runCodexLogin(workspaceId);

      // 检查用户是否在登录过程中取消了操作
      if (accountSwitchCanceledRef.current) {
        loginIdRef.current = loginId;
        try {
          await cancelCodexLogin(workspaceId);
        } catch {
          // 尝试取消：用户已经取消了操作
        }
        setAccountSwitching(false);
        accountSwitchCanceledRef.current = false;
        loginIdRef.current = null;
        loginWorkspaceIdRef.current = null;
        return;
      }

      loginIdRef.current = loginId;
      await openUrl(authUrl);
    } catch (error) {
      // 处理登录过程中的错误
      if (accountSwitchCanceledRef.current || isCodexLoginCanceled(error)) {
        setAccountSwitching(false);
        accountSwitchCanceledRef.current = false;
        loginIdRef.current = null;
        loginWorkspaceIdRef.current = null;
        return;
      }
      alertError(error);
      if (loginIdRef.current) {
        try {
          await cancelCodexLogin(workspaceId);
        } catch {
          // 忽略取消错误：我们已经处理了主要的失败情况
        }
      }
      setAccountSwitching(false);
      accountSwitchCanceledRef.current = false;
      loginIdRef.current = null;
      loginWorkspaceIdRef.current = null;
    } finally {
      // 完成处理现在由应用服务器事件驱动
    }
  }, [
    activeWorkspaceId,
    accountSwitching,
    alertError,
    isCodexLoginCanceled,
  ]);

  // 处理取消账户切换操作
  const handleCancelSwitchAccount = useCallback(async () => {
    const targetWorkspaceId = loginWorkspaceIdRef.current ?? activeWorkspaceId;
    if (!targetWorkspaceId || (!accountSwitchingRef.current && !loginWorkspaceIdRef.current)) {
      return;
    }
    accountSwitchCanceledRef.current = true;
    try {
      await cancelCodexLogin(targetWorkspaceId);
    } catch (error) {
      alertError(error);
    } finally {
      setAccountSwitching(false);
      loginIdRef.current = null;
      loginWorkspaceIdRef.current = null;
    }
  }, [activeWorkspaceId, alertError]);

  // 返回账户切换相关的状态和处理函数
  return {
    activeAccount, // 当前活动的账户
    accountSwitching, // 账户切换状态
    handleSwitchAccount, // 处理账户切换的函数
    handleCancelSwitchAccount, // 处理取消账户切换的函数
  };
}
