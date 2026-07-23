import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import X from "lucide-react/dist/esm/icons/x";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import UserPlus from "lucide-react/dist/esm/icons/user-plus";
import wechatIcon from "@/assets/svg-icons/wechat.svg";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { getAppServerParams, getAppServerRawMethod } from "@/utils/appServerEvents";
import { hasUsableAccountSnapshot, normalizeAccountSnapshot } from "@app/utils/accountSnapshot";
import {
  subscribeAppServerEvents,
  subscribeLadonxAuthChanged,
  subscribeLadonxLoginRequested,
  subscribeLadonxWechatAuth,
} from "@services/events";
import {
  cancelWechatLadonxAuth,
  getLadonxAuthStatus,
  loginWechatLadonxAuth,
  loginLadonxAuth,
  relaunchApp,
  registerLadonxAuth,
  writeStartupLog,
} from "@services/tauri";
import { getLadonxApiBaseUrl } from "@services/runtimeDefaults";

type AuthGateProps = {
  hasLoadedWorkspaces: boolean;
  onAuthReadyChange?: (ready: boolean) => void;
  onSignedInChange?: (signedIn: boolean) => void;
  addDebugEntry?: (entry: {
    id: string;
    timestamp: number;
    source: "client" | "server" | "error";
    label: string;
    payload?: unknown;
  }) => void;
  children: React.ReactNode;
};

type AuthGateStatus = "checking" | "signed-out" | "signed-in";
type AuthGateMode = "wechat" | "login" | "register";
type WechatWidgetConfig = {
  appid: string;
  redirectUri: string;
  scope: string;
  state: string;
  qrImageUrl: string;
};

type AuthGateControllerOptions = {
  hasLoadedWorkspaces: boolean;
  onAuthReadyChange?: (ready: boolean) => void;
  onSignedInChange?: (signedIn: boolean) => void;
  addDebugEntry?: AuthGateProps["addDebugEntry"];
  enableWechatWindowFlow?: boolean;
};

function useAuthGateController({
  hasLoadedWorkspaces,
  onAuthReadyChange,
  onSignedInChange,
  addDebugEntry,
  enableWechatWindowFlow = false,
}: AuthGateControllerOptions) {
  const { t } = useI18nSafe();
  const [status, setStatus] = useState<AuthGateStatus>("checking");
  const [mode, setMode] = useState<AuthGateMode>("wechat");
  const [accountInput, setAccountInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [registerEmailInput, setRegisterEmailInput] = useState("");
  const [registerUsernameInput, setRegisterUsernameInput] = useState("");
  const [registerPasswordInput, setRegisterPasswordInput] = useState("");
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const [checkVersion, setCheckVersion] = useState(0);
  const [wechatRefreshVersion, setWechatRefreshVersion] = useState(0);
  const [wechatWidgetConfig, setWechatWidgetConfig] = useState<WechatWidgetConfig | null>(null);
  const [isWechatConnecting, setIsWechatConnecting] = useState(false);
  const [isRestartingAfterWechatLogin, setIsRestartingAfterWechatLogin] = useState(false);
  const loginIdRef = useRef<string | null>(null);
  const canceledRef = useRef(false);
  const wechatAttemptIdRef = useRef<string | null>(null);
  const statusRef = useRef<AuthGateStatus>("checking");
  const authStatusRequestIdRef = useRef(0);
  const wechatStatusPollInFlightRef = useRef(false);
  const wechatSuccessStatusTimerRef = useRef<number | null>(null);

  const logAuthGate = useCallback((message: string) => {
    void writeStartupLog(`auth-gate: ${message}`).catch(() => {
      // Ignore logging failures in production auth flow.
    });
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    onAuthReadyChange?.(status !== "checking");
    onSignedInChange?.(status === "signed-in");
  }, [onAuthReadyChange, onSignedInChange, status]);

  useEffect(() => {
    logAuthGate(`status=${status}, mode=${mode}, hasLoadedWorkspaces=${hasLoadedWorkspaces}`);
  }, [hasLoadedWorkspaces, logAuthGate, mode, status]);

  const refreshAuthStatus = useCallback(() => {
    setCheckVersion((version) => version + 1);
  }, []);

  const cancelWechatAttempt = useCallback(
    async (reason: string) => {
      const attemptId = wechatAttemptIdRef.current;
      if (!attemptId) {
        return false;
      }
      wechatAttemptIdRef.current = null;
      try {
        const result = await cancelWechatLadonxAuth(attemptId);
        logAuthGate(
          `wechat_login:cancel attemptId=${attemptId}, reason=${reason}, canceled=${Boolean(result?.canceled)}`,
        );
        return Boolean(result?.canceled);
      } catch (error) {
        logAuthGate(
          `wechat_login:cancel_error attemptId=${attemptId}, reason=${reason}, message=${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    },
    [logAuthGate],
  );

  const refreshWechatQrCode = useCallback(() => {
    if (
      isWechatConnecting ||
      isRestartingAfterWechatLogin ||
      mode !== "wechat" ||
      !hasLoadedWorkspaces
    ) {
      return;
    }
    void cancelWechatAttempt("refresh-qrcode");
    setError(null);
    setWechatWidgetConfig(null);
    setWechatRefreshVersion((version) => version + 1);
  }, [
    cancelWechatAttempt,
    hasLoadedWorkspaces,
    isRestartingAfterWechatLogin,
    isWechatConnecting,
    mode,
  ]);

  const clearWechatSuccessStatusTimer = useCallback(() => {
    if (wechatSuccessStatusTimerRef.current === null) {
      return;
    }
    window.clearTimeout(wechatSuccessStatusTimerRef.current);
    wechatSuccessStatusTimerRef.current = null;
  }, []);

  const completeWechatLogin = useCallback(() => {
    clearWechatSuccessStatusTimer();
    void cancelWechatAttempt("login-completed");
    setError(null);
    setIsWechatConnecting(false);
    setWechatWidgetConfig(null);
    setStatus("checking");
    setIsRestartingAfterWechatLogin(true);
    wechatSuccessStatusTimerRef.current = window.setTimeout(() => {
      wechatSuccessStatusTimerRef.current = null;
      logAuthGate("wechat_login:completed");
      setIsRestartingAfterWechatLogin(false);
      refreshAuthStatus();
    }, 200);
  }, [cancelWechatAttempt, clearWechatSuccessStatusTimer, logAuthGate, refreshAuthStatus]);

  const handleWechatLoginSuccess = useCallback(
    async (payload: { attemptId: string; shouldRestart?: boolean }) => {
      logAuthGate(
        `wechat_event:success attemptId=${payload.attemptId}, shouldRestart=${Boolean(payload.shouldRestart)}`,
      );
      completeWechatLogin();

      if (!payload.shouldRestart) {
        return;
      }

      try {
        await relaunchApp();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logAuthGate(`wechat_relaunch:error ${message}`);
        setIsRestartingAfterWechatLogin(false);
        setStatus("signed-out");
        setError(`登录成功，但自动重启失败: ${message}`);
      }
    },
    [completeWechatLogin, logAuthGate],
  );

  useEffect(() => {
    return () => {
      clearWechatSuccessStatusTimer();
      void cancelWechatAttempt("component-unmount");
    };
  }, [cancelWechatAttempt, clearWechatSuccessStatusTimer]);

  useEffect(() => {
    let canceled = false;
    const requestId = ++authStatusRequestIdRef.current;
    if (!hasLoadedWorkspaces) {
      setStatus("checking");
      return () => {
        canceled = true;
      };
    }

    setStatus((current) => (current === "signed-in" ? current : "checking"));
    void (async () => {
      try {
        logAuthGate(`auth_status_request:start requestId=${requestId}`);
        const response = await getLadonxAuthStatus(await getLadonxApiBaseUrl());
        if (canceled || requestId !== authStatusRequestIdRef.current) {
          logAuthGate(`auth_status_request:stale requestId=${requestId}`);
          return;
        }
        const snapshot = normalizeAccountSnapshot(response);
        logAuthGate(
          `auth_status_request:finish requestId=${requestId}, usable=${hasUsableAccountSnapshot(snapshot)}, type=${snapshot.type}, email=${snapshot.email ?? ""}, planType=${snapshot.planType ?? ""}`,
        );
        setStatus(hasUsableAccountSnapshot(snapshot) ? "signed-in" : "signed-out");
        setError(null);
      } catch (authError) {
        if (canceled || requestId !== authStatusRequestIdRef.current) {
          logAuthGate(`auth_status_request:error-stale requestId=${requestId}`);
          return;
        }
        const message = authError instanceof Error ? authError.message : String(authError);
        logAuthGate(`auth_status_request:error requestId=${requestId}, message=${message}`);
        addDebugEntry?.({
          id: `${Date.now()}-client-auth-status-error`,
          timestamp: Date.now(),
          source: "error",
          label: "ladonx/auth-status error",
          payload: message,
        });
        setStatus("signed-out");
        setError(message);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [addDebugEntry, checkVersion, hasLoadedWorkspaces, logAuthGate]);

  useEffect(() => {
    if (status === "signed-in") {
      void cancelWechatAttempt("status-signed-in");
      setWechatWidgetConfig(null);
      setIsSubmittingLogin(false);
      setIsWechatConnecting(false);
      setIsRestartingAfterWechatLogin(false);
    }
  }, [cancelWechatAttempt, status]);

  useEffect(() => {
    if (mode !== "wechat") {
      void cancelWechatAttempt("mode-changed");
      setWechatWidgetConfig(null);
      setIsWechatConnecting(false);
      setIsRestartingAfterWechatLogin(false);
    }
  }, [cancelWechatAttempt, mode]);

  useEffect(() => {
    const unlisten = subscribeAppServerEvents((payload) => {
      const method = getAppServerRawMethod(payload);
      if (method !== "account/login/completed" && method !== "account/updated") {
        return;
      }

      if (method === "account/login/completed") {
        const params = getAppServerParams(payload);
        const loginId = String(params.loginId ?? params.login_id ?? "");
        if (loginIdRef.current && loginId && loginId !== loginIdRef.current) {
          return;
        }
        const success = Boolean(params.success);
        const loginError = String(params.error ?? "").trim();
        loginIdRef.current = null;
        if (!success) {
          if (!canceledRef.current && loginError) {
            setError(loginError);
          }
          canceledRef.current = false;
          return;
        }
        canceledRef.current = false;
      }

      refreshAuthStatus();
    });

    return () => {
      unlisten();
    };
  }, [refreshAuthStatus]);

  useEffect(() => {
    return subscribeLadonxAuthChanged(() => {
      loginIdRef.current = null;
      canceledRef.current = true;
      void cancelWechatAttempt("auth-changed");
      setIsSubmittingLogin(false);
      setIsWechatConnecting(false);
      setStatus((current) => (current === "signed-in" ? current : "checking"));
      refreshAuthStatus();
    });
  }, [cancelWechatAttempt, refreshAuthStatus]);

  useEffect(() => {
    if (!enableWechatWindowFlow) {
      return;
    }
    return subscribeLadonxWechatAuth((payload) => {
      if (statusRef.current === "signed-in") {
        return;
      }
      if (!wechatAttemptIdRef.current || payload.attemptId !== wechatAttemptIdRef.current) {
        return;
      }

      if (payload.type === "qrcode") {
        logAuthGate(`wechat_event:qrcode attemptId=${payload.attemptId}`);
        setError(null);
        setWechatWidgetConfig(
          payload.appid && payload.redirectUri && payload.scope && payload.state
            ? {
                appid: payload.appid,
                redirectUri: payload.redirectUri,
                scope: payload.scope,
                state: payload.state,
                qrImageUrl: payload.qrImageUrl ?? "",
              }
            : null,
        );
        return;
      }

      if (payload.type === "success") {
        void handleWechatLoginSuccess(payload);
        return;
      }

      logAuthGate(
        `wechat_event:${payload.type} attemptId=${payload.attemptId}, message=${payload.message?.trim() ?? ""}`,
      );
      setIsWechatConnecting(false);
      setIsRestartingAfterWechatLogin(false);
      setWechatWidgetConfig(null);
      setStatus("signed-out");
      setError(payload.message?.trim() || null);
    });
  }, [enableWechatWindowFlow, handleWechatLoginSuccess, logAuthGate]);

  useEffect(() => {
    if (!enableWechatWindowFlow) {
      return;
    }
    if (mode !== "wechat" || !hasLoadedWorkspaces || status === "signed-in") {
      return;
    }
    if (wechatAttemptIdRef.current) {
      return;
    }

    const attemptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    wechatAttemptIdRef.current = attemptId;
    logAuthGate(`wechat_login:start attemptId=${attemptId}`);
    setError(null);
    setWechatWidgetConfig(null);
    setIsWechatConnecting(true);

    void (async () => {
      try {
        await loginWechatLadonxAuth({
          attemptId,
          apiBaseUrl: await getLadonxApiBaseUrl(),
        });
      } catch (wechatError) {
        if (wechatAttemptIdRef.current !== attemptId) {
          return;
        }
        const message = wechatError instanceof Error ? wechatError.message : String(wechatError);
        setIsWechatConnecting(false);
        setWechatWidgetConfig(null);
        setError(message);
      }
    })();

    return () => {
      if (wechatAttemptIdRef.current === attemptId) {
        void cancelWechatAttempt("effect-cleanup");
      }
    };
  }, [
    cancelWechatAttempt,
    enableWechatWindowFlow,
    hasLoadedWorkspaces,
    logAuthGate,
    mode,
    status,
    wechatRefreshVersion,
  ]);

  useEffect(() => {
    if (!enableWechatWindowFlow) {
      return;
    }
    if (
      mode !== "wechat" ||
      !hasLoadedWorkspaces ||
      status === "signed-in" ||
      (!isWechatConnecting && !wechatWidgetConfig)
    ) {
      return;
    }

    let canceled = false;
    const poll = async () => {
      if (wechatStatusPollInFlightRef.current) {
        return;
      }
      wechatStatusPollInFlightRef.current = true;
      try {
        const response = await getLadonxAuthStatus(await getLadonxApiBaseUrl());
        if (canceled) {
          return;
        }
        const snapshot = normalizeAccountSnapshot(response);
        const usable = hasUsableAccountSnapshot(snapshot);
        logAuthGate(
          `wechat_status_poll: usable=${usable}, type=${snapshot.type}, email=${snapshot.email ?? ""}, planType=${snapshot.planType ?? ""}`,
        );
        if (!usable) {
          return;
        }
        const completedAttemptId = wechatAttemptIdRef.current ?? "status-poll";
        void handleWechatLoginSuccess({
          attemptId: completedAttemptId,
          shouldRestart: false,
        });
      } catch (pollError) {
        if (!canceled) {
          logAuthGate(
            `wechat_status_poll:error ${pollError instanceof Error ? pollError.message : String(pollError)}`,
          );
        }
      } finally {
        wechatStatusPollInFlightRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 1000);

    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [
    enableWechatWindowFlow,
    handleWechatLoginSuccess,
    hasLoadedWorkspaces,
    isWechatConnecting,
    logAuthGate,
    mode,
    status,
    wechatWidgetConfig,
  ]);

  const handleLogin = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingLogin) {
      return;
    }

    const accountValue = accountInput.trim();
    if (!accountValue || !passwordInput) {
      setError(String(t("auth.enterAccountAndPassword")));
      return;
    }

    setError(null);
    setStatus("signed-out");
    setIsSubmittingLogin(true);
    canceledRef.current = false;

    try {
      const response = await loginLadonxAuth(
        accountValue,
        passwordInput,
        await getLadonxApiBaseUrl(),
      );
      const snapshot = normalizeAccountSnapshot(response);
      setStatus(hasUsableAccountSnapshot(snapshot) ? "signed-in" : "signed-out");
      if (!hasUsableAccountSnapshot(snapshot)) {
        refreshAuthStatus();
      }
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : String(loginError);
      loginIdRef.current = null;
      setStatus("signed-out");
      setError(message);
    } finally {
      setIsSubmittingLogin(false);
    }
  }, [accountInput, isSubmittingLogin, passwordInput, refreshAuthStatus, t]);

  const handleRegister = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmittingLogin) {
      return;
    }

    const email = registerEmailInput.trim();
    const username = registerUsernameInput.trim();
    if (!email || !username || !registerPasswordInput) {
      setError(String(t("auth.enterEmailUsernameAndPassword")));
      return;
    }

    setError(null);
    setStatus("signed-out");
    setIsSubmittingLogin(true);
    canceledRef.current = false;

    try {
      await registerLadonxAuth({
        email,
        username,
        displayName: username,
        password: registerPasswordInput,
        apiBaseUrl: await getLadonxApiBaseUrl(),
      });
      setRegistrationSuccess(true);
      setMode("login");
    } catch (registerError) {
      const message = registerError instanceof Error ? registerError.message : String(registerError);
      loginIdRef.current = null;
      setStatus("signed-out");
      setError(message);
    } finally {
      setIsSubmittingLogin(false);
    }
  }, [
    isSubmittingLogin,
    registerEmailInput,
    registerPasswordInput,
    registerUsernameInput,
    t,
  ]);

  return {
    t,
    status,
    mode,
    setMode,
    accountInput,
    setAccountInput,
    passwordInput,
    setPasswordInput,
    registerEmailInput,
    setRegisterEmailInput,
    registerUsernameInput,
    setRegisterUsernameInput,
    registerPasswordInput,
    setRegisterPasswordInput,
    isSubmittingLogin,
    error,
    registrationSuccess,
    setRegistrationSuccess,
    wechatWidgetConfig,
    isWechatConnecting,
    isRestartingAfterWechatLogin,
    refreshAuthStatus,
    refreshWechatQrCode,
    handleLogin,
    handleRegister,
  };
}

function SharedAuthContent({
  controller,
  hasLoadedWorkspaces,
  showWechatInline,
}: {
  controller: ReturnType<typeof useAuthGateController>;
  hasLoadedWorkspaces: boolean;
  showWechatInline: boolean;
}) {
  const {
    t,
    status,
    mode,
    setMode,
    accountInput,
    setAccountInput,
    passwordInput,
    setPasswordInput,
    registerEmailInput,
    setRegisterEmailInput,
    registerUsernameInput,
    setRegisterUsernameInput,
    registerPasswordInput,
    setRegisterPasswordInput,
    isSubmittingLogin,
    error,
    registrationSuccess,
    setRegistrationSuccess,
    wechatWidgetConfig,
    isWechatConnecting,
    isRestartingAfterWechatLogin,
    refreshWechatQrCode,
    handleLogin,
    handleRegister,
  } = controller;

  const isLoggingIn = isSubmittingLogin;
  const isChecking = status === "checking" && !isLoggingIn;

  return (
    <>
      {/* <div className="auth-gate-icon" aria-hidden>
        <img src="/app-icon.png" alt="" />
      </div> */}
      {/* <h1 id="auth-gate-title">{String(t("auth.welcome"))}</h1> */}

      <div className="auth-gate-tabs" role="tablist" aria-label={String(t("auth.loginMethods"))}>
        <button
          type="button"
          className={mode === "wechat" ? "is-active" : undefined}
          onClick={() => setMode("wechat")}
        >
          {String(t("auth.wechatScan"))}
        </button>
        <button
          type="button"
          className={mode === "login" ? "is-active" : undefined}
          onClick={() => setMode("login")}
        >
          {String(t("auth.accountLogin"))}
        </button>
        <button
          type="button"
          className={mode === "register" ? "is-active" : undefined}
          onClick={() => setMode("register")}
        >
          {String(t("auth.register"))}
        </button>
      </div>

      {mode === "wechat" ? (
        showWechatInline ? (
          <div className="auth-gate-wechat">
            <div className="auth-gate-qr" aria-label={String(t("auth.wechatQrLabel"))}>
              {wechatWidgetConfig ? (
                <iframe
                  className="auth-gate-wechat-frame"
                  src={wechatWidgetConfig.qrImageUrl}
                  title={String(t("auth.wechatQrLabel"))}
                  referrerPolicy="no-referrer-when-downgrade"
                  sandbox="allow-scripts allow-forms allow-top-navigation"
                />
              ) : (
                <button
                  type="button"
                  className="auth-gate-wechat-refresh"
                  onClick={refreshWechatQrCode}
                  disabled={
                    isWechatConnecting || isRestartingAfterWechatLogin || !hasLoadedWorkspaces
                  }
                  aria-label={String(t("auth.refreshWechatQr"))}
                  title={String(t("auth.refreshWechatQr"))}
                >
                  <img className="auth-gate-wechat-mark" src={wechatIcon} alt="" />
                </button>
              )}
            </div>
            {isRestartingAfterWechatLogin ? (
              <span>登录成功，正在加载...</span>
            ) : isWechatConnecting && !wechatWidgetConfig ? (
              <span>正在加载二维码...</span>
            ) : !wechatWidgetConfig ? (
              <span>二维码加载失败，可点击重试</span>
            ) : null}
          </div>
        ) : null
      ) : null}

      {mode === "login" ? (
        <form className="auth-gate-form" onSubmit={handleLogin}>
          <label className="auth-gate-field">
            <span>{String(t("auth.accountLabel"))}</span>
            <input
              type="text"
              value={accountInput}
              onChange={(event) => setAccountInput(event.target.value)}
              placeholder={String(t("auth.accountPlaceholder"))}
              autoComplete="username"
              disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
            />
          </label>
          <label className="auth-gate-field">
            <span>{String(t("auth.passwordLabel"))}</span>
            <input
              type="password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder={String(t("auth.passwordPlaceholder"))}
              autoComplete="current-password"
              disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
            />
          </label>
          <button
            type="submit"
            className="auth-gate-primary"
            disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
          >
            {isLoggingIn || isChecking ? (
              <LoaderCircle className="auth-gate-spinner" aria-hidden />
            ) : (
              <LogIn aria-hidden />
            )}
            <span>
              {isLoggingIn
                ? String(t("auth.loggingIn"))
                : isChecking
                  ? String(t("auth.checkingStatus"))
                  : String(t("auth.loginButton"))}
            </span>
          </button>
        </form>
      ) : null}

      {mode === "register" ? (
        <form className="auth-gate-form" onSubmit={handleRegister}>
          <label className="auth-gate-field">
            <span>{String(t("auth.emailLabel"))}</span>
            <input
              type="email"
              value={registerEmailInput}
              onChange={(event) => setRegisterEmailInput(event.target.value)}
              placeholder={String(t("auth.emailPlaceholder"))}
              autoComplete="email"
              disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
            />
          </label>
          <label className="auth-gate-field">
            <span>{String(t("auth.usernameLabel"))}</span>
            <input
              type="text"
              value={registerUsernameInput}
              onChange={(event) => setRegisterUsernameInput(event.target.value)}
              placeholder={String(t("auth.usernamePlaceholder"))}
              autoComplete="username"
              disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
            />
          </label>
          <label className="auth-gate-field">
            <span>{String(t("auth.passwordLabel"))}</span>
            <input
              type="password"
              value={registerPasswordInput}
              onChange={(event) => setRegisterPasswordInput(event.target.value)}
              placeholder={String(t("auth.registerPasswordPlaceholder"))}
              autoComplete="new-password"
              disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
            />
          </label>
          <button
            type="submit"
            className="auth-gate-primary"
            disabled={isChecking || isLoggingIn || !hasLoadedWorkspaces}
          >
            {isLoggingIn || isChecking ? (
              <LoaderCircle className="auth-gate-spinner" aria-hidden />
            ) : (
              <UserPlus aria-hidden />
            )}
            <span>
              {isLoggingIn
                ? String(t("auth.registering"))
                : isChecking
                  ? String(t("auth.checkingStatus"))
                  : String(t("auth.registerButton"))}
            </span>
          </button>
        </form>
      ) : null}

      {isLoggingIn ? <p className="auth-gate-muted">{String(t("auth.verifyingAccount"))}</p> : null}
      {error ? <p className="auth-gate-error">{error}</p> : null}

      {registrationSuccess ? (
        <div className="auth-gate-success-dialog" role="dialog" aria-modal="true" aria-label="注册成功">
          <div
            className="auth-gate-success-dialog-backdrop"
            onClick={() => setRegistrationSuccess(false)}
          />
          <div className="auth-gate-success-dialog-card">
            <h3 className="auth-gate-success-dialog-title">注册成功</h3>
            <p className="auth-gate-success-dialog-text">
              您的账号已注册成功，请切换到登录页面进行登录。
            </p>
            <button
              type="button"
              className="auth-gate-primary"
              onClick={() => setRegistrationSuccess(false)}
            >
              确定
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function AuthGate({
  hasLoadedWorkspaces,
  onAuthReadyChange,
  onSignedInChange,
  addDebugEntry,
  children,
}: AuthGateProps) {
  const controller = useAuthGateController({
    hasLoadedWorkspaces,
    onAuthReadyChange,
    onSignedInChange,
    addDebugEntry,
    enableWechatWindowFlow: true,
  });
  const refreshAuthStatus = controller.refreshAuthStatus;
  const [isAuthModalDismissed, setIsAuthModalDismissed] = useState(true);
  const shouldShowAuthModal =
    controller.status !== "signed-in" &&
    !isAuthModalDismissed &&
    !controller.isRestartingAfterWechatLogin;
  const modalPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (controller.status === "signed-in") {
      setIsAuthModalDismissed(true);
    }
  }, [controller.status]);

  useEffect(() => subscribeLadonxLoginRequested(() => {
    setIsAuthModalDismissed(false);
    refreshAuthStatus();
  }), [refreshAuthStatus]);

  useEffect(() => {
    if (!shouldShowAuthModal) {
      return;
    }
    modalPanelRef.current?.focus();
  }, [shouldShowAuthModal]);

  return (
    <>
      <div className="auth-gate-app">{children}</div>
      {shouldShowAuthModal ? (
        <div
          className="auth-gate auth-gate-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-gate-title"
          data-tauri-drag-region
        >
          <div className="auth-gate-backdrop" />
          <section
            ref={modalPanelRef}
            className="auth-gate-panel"
            aria-busy={controller.status === "checking" || controller.isSubmittingLogin}
            tabIndex={-1}
          >
            <button
              type="button"
              className="auth-gate-close"
              onClick={() => setIsAuthModalDismissed(true)}
              aria-label="关闭登录窗口"
              title="关闭登录窗口"
            >
              <X aria-hidden />
            </button>
            <SharedAuthContent
              controller={controller}
              hasLoadedWorkspaces={hasLoadedWorkspaces}
              showWechatInline
            />
          </section>
        </div>
      ) : null}
    </>
  );
}

export function WechatAuthWindow() {
  const controller = useAuthGateController({
    hasLoadedWorkspaces: true,
    enableWechatWindowFlow: true,
  });

  useEffect(() => {
    if (controller.status !== "signed-in") {
      return;
    }
    void getCurrentWindow()
      .close()
      .catch(() => {
        // Ignore close failures in the auth helper window.
      });
  }, [controller.isRestartingAfterWechatLogin, controller.status]);

  return (
    <main className="auth-gate" data-tauri-drag-region>
      <section
        className="auth-gate-panel"
        aria-busy={controller.status === "checking" || controller.isSubmittingLogin}
      >
        <SharedAuthContent
          controller={controller}
          hasLoadedWorkspaces
          showWechatInline
        />
      </section>
    </main>
  );
}
