import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  LoaderCircle,
  LogIn,
  LogOut,
  ExternalLink,
  Settings,
  UserCircle,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { hasUsableAccountSnapshot, normalizeAccountSnapshot } from "@app/utils/accountSnapshot";
import {
  PopoverMenuItem,
  PopoverSurface,
} from "../../design-system/components/popover/PopoverPrimitives";
import { useMenuController } from "../hooks/useMenuController";
import {
  notifyLadonxAuthChanged,
  notifyLadonxLoginRequested,
  subscribeLadonxAuthChanged,
} from "@services/events";
import {
  getLadonxAuthStatus,
  getLadonxUserSubscriptions,
  logoutLadonxAuth,
  type UserSubscriptionQuota,
} from "@services/tauri";
import { getLadonxApiBaseUrl } from "@services/runtimeDefaults";

type SidebarBottomRailProps = {
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton: boolean;
  hidden?: boolean;
};

type SidebarUser = {
  displayName: string;
  username: string;
  email: string;
  headimgurl: string;
  accountType: "chatgpt" | "apikey" | "unknown";
};

type PopoverView = "menu" | "usage";
type QuotaRingProps = {
  percent: number;
  onClick?: () => void;
  tooltip?: ReactNode;
};
const LOGOUT_TIMEOUT_MS = 6000;
const UPGRADE_URL = "https://www.ladonx.com/user/billing";

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("退出登录超时"));
    }, timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => {
        window.clearTimeout(timeout);
      });
  });
}

function normalizeSidebarUser(response: unknown): SidebarUser | null {
  const root = response && typeof response === "object" ? response as Record<string, unknown> : null;
  const result = root?.result && typeof root.result === "object"
    ? root.result as Record<string, unknown>
    : null;
  const accountValue = result?.account ?? root?.account;
  const account = accountValue && typeof accountValue === "object"
    ? accountValue as Record<string, unknown>
    : null;
  const user = account?.user && typeof account.user === "object"
    ? account.user as Record<string, unknown>
    : null;
  if (!account && !user) {
    return null;
  }

  const snapshot = normalizeAccountSnapshot(root);
  if (!hasUsableAccountSnapshot(snapshot)) {
    return null;
  }

  const displayName =
    readString(user?.displayName) ||
    readString(account?.displayName) ||
    readString(user?.username) ||
    readString(account?.username) ||
    readString(user?.email) ||
    readString(account?.email) ||
    snapshot.email ||
    (snapshot.type === "apikey" ? "API Key" : "LadonX");

  return {
    displayName,
    username: readString(user?.username) || readString(account?.username),
    email: readString(user?.email) || readString(account?.email) || snapshot.email || "",
    headimgurl:
      readString(user?.headimgurl) ||
      readString(user?.headImgUrl) ||
      readString(account?.headimgurl) ||
      readString(account?.headImgUrl),
    accountType: snapshot.type,
  };
}

// 从订阅列表中提取日/周/月用量，取所有返回订阅的用量之和。
function extractQuotas(
  subscriptions: Array<{ status: string; quotas: UserSubscriptionQuota[] }>,
): UserSubscriptionQuota[] {
  const daily = { label: "日额度", used: 0, total: 0, resetIn: "次日 0 点" };
  const weekly = { label: "周额度", used: 0, total: 0, resetIn: "每周一 0 点" };
  const monthly = { label: "月额度", used: 0, total: 0, resetIn: "每月 1 日 0 点" };

  for (const sub of subscriptions) {
    for (const q of sub.quotas) {
      if (q.label.includes("日")) {
        daily.used += q.used;
        daily.total += q.total;
      } else if (q.label.includes("周")) {
        weekly.used += q.used;
        weekly.total += q.total;
      } else if (q.label.includes("月")) {
        monthly.used += q.used;
        monthly.total += q.total;
      }
    }
  }

  return [daily, weekly, monthly];
}

function QuotaRing({ percent, onClick, tooltip }: QuotaRingProps) {
  return (
    <div className="sidebar-quota-ring-wrap">
      <button
        type="button"
        className="sidebar-quota-ring"
        onClick={onClick}
        aria-label="刷新使用情况"
        title="刷新使用情况"
        style={{ background: `conic-gradient(var(--sidebar-quota-ring-fill) ${percent}%, var(--sidebar-quota-ring-track) 0)` }}
      >
        <span className="sidebar-quota-ring-inner" />
      </button>
      {tooltip ? (
        <div className="sidebar-quota-ring-tooltip" role="tooltip">
          {tooltip}
        </div>
      ) : null}
    </div>
  );
}

function UsagePanel({
  quotas,
  loading,
}: {
  quotas: UserSubscriptionQuota[];
  loading: boolean;
}) {
  if (loading && quotas.length === 0) {
    return (
      <div className="sidebar-usage-loading">
        <LoaderCircle size={14} className="sidebar-refresh-icon spinning" aria-hidden />
        <span>加载中...</span>
      </div>
    );
  }

  if (quotas.length === 0) {
    return <div className="sidebar-usage-empty">暂无可用订阅数据</div>;
  }

  return (
    <>
      {quotas.map((quota, index) => {
        const percent = quota.total > 0
          ? Math.min(Math.round((quota.used / quota.total) * 100), 100)
          : 0;
        return (
          <div key={index} className="sidebar-quota-item">
            <div className="sidebar-quota-header">
              <span className="sidebar-quota-label">{quota.label}</span>
              <span className="sidebar-quota-value">{percent}%</span>
            </div>
            <div className="sidebar-quota-bar">
              <div
                className="sidebar-quota-bar-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="sidebar-quota-reset">{quota.resetIn}</div>
          </div>
        );
      })}
    </>
  );
}

export function SidebarBottomRail({
  onOpenSettings,
  hidden = false,
}: SidebarBottomRailProps) {
  const { t } = useI18nSafe();
  const [user, setUser] = useState<SidebarUser | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [popoverView, setPopoverView] = useState<PopoverView>("menu");
  const [quotas, setQuotas] = useState<UserSubscriptionQuota[]>([]);
  const [quotasLoading, setQuotasLoading] = useState(false);
  const accountMenu = useMenuController();

  const refreshUser = useCallback(() => {
    let canceled = false;
    void (async () => {
      try {
        const response = await getLadonxAuthStatus(await getLadonxApiBaseUrl());
        if (!canceled) {
          setUser(normalizeSidebarUser(response));
        }
      } catch {
        if (!canceled) {
          setUser(null);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, []);

  // 拉取订阅额度数据
  const refreshQuotas = useCallback(() => {
    let canceled = false;
    if (!user) {
      setQuotas([]);
      setQuotasLoading(false);
      return () => {
        canceled = true;
      };
    }
    setQuotasLoading(true);
    void (async () => {
      try {
        const response = await getLadonxUserSubscriptions(await getLadonxApiBaseUrl());
        if (!canceled) {
          const subs = Array.isArray(response?.data) ? response.data : [];
          setQuotas(extractQuotas(subs));
        }
      } catch {
        if (!canceled) {
          setQuotas([]);
        }
      } finally {
        if (!canceled) {
          setQuotasLoading(false);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [user]);

  useEffect(() => refreshUser(), [refreshUser]);
  useEffect(() => refreshQuotas(), [refreshQuotas]);

  useEffect(() => subscribeLadonxAuthChanged(() => {
    refreshUser();
  }), [refreshUser]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const timer = window.setInterval(() => {
      refreshQuotas();
    }, 10 * 60 * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshQuotas, user]);

  useEffect(() => {
    if (!accountMenu.isOpen && popoverView !== "menu") {
      setPopoverView("menu");
    }
  }, [accountMenu.isOpen, popoverView]);

  const initials = useMemo(() => {
    const label = user?.displayName || "LadonX";
    return Array.from(label.trim()).slice(0, 2).join("").toUpperCase();
  }, [user?.displayName]);

  const loginStatusLabel = user
    ? user.accountType === "apikey"
      ? String(t("sidebar.account.signedInWithApiKey"))
      : String(t("sidebar.account.signedIn"))
    : String(t("sidebar.account.localMode"));

  const handleOpenSettings = useCallback(() => {
    accountMenu.close();
    onOpenSettings();
  }, [accountMenu, onOpenSettings]);

  const handleShowUsage = useCallback(() => {
    setPopoverView("usage");
    refreshQuotas();
  }, [refreshQuotas]);

  const handleUpgradePlan = useCallback(() => {
    accountMenu.close();
    void openUrl(UPGRADE_URL);
  }, [accountMenu]);

  const handleBackToMenu = useCallback(() => {
    setPopoverView("menu");
  }, []);

  const handleLogin = useCallback(() => {
    accountMenu.close();
    notifyLadonxLoginRequested();
  }, [accountMenu]);

  const handleAccountButtonClick = useCallback(() => {
    accountMenu.toggle();
  }, [accountMenu]);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await withTimeout(logoutLadonxAuth(), LOGOUT_TIMEOUT_MS);
      setUser(null);
      setQuotas([]);
      accountMenu.close();
      notifyLadonxAuthChanged();
    } catch (error) {
      console.error("[LadonX] logout failed", error);
      refreshUser();
      notifyLadonxAuthChanged();
    } finally {
      setIsLoggingOut(false);
    }
  }, [accountMenu, isLoggingOut, refreshUser]);

  const dailyQuotaPercent = useMemo(() => {
    const dailyQuota = quotas[0];
    if (!dailyQuota || dailyQuota.total <= 0) {
      return 0;
    }
    return Math.min(Math.round((dailyQuota.used / dailyQuota.total) * 100), 100);
  }, [quotas]);

  if (hidden) {
    return null;
  }

  return (
    <div className="sidebar-bottom-rail">
      <div className="sidebar-bottom-actions is-compact">
        <div className="sidebar-utility-actions">
          <div className="sidebar-account-menu" ref={accountMenu.containerRef}>
            <button
              className={`ghost sidebar-labeled-button sidebar-user-button${accountMenu.isOpen ? " is-open" : ""}`}
              type="button"
              onClick={handleAccountButtonClick}
              aria-haspopup="menu"
              aria-expanded={accountMenu.isOpen}
              aria-label={user ? user.displayName : String(t("sidebar.account.signedOut"))}
              title={user ? user.email || user.username || user.displayName : String(t("sidebar.account.signedOut"))}
            >
              <span className="sidebar-user-avatar" aria-hidden>
                {user?.headimgurl ? <img src={user.headimgurl} alt="" /> : <span>{initials}</span>}
              </span>
              <span className="sidebar-user-name">
                {user?.displayName || String(t("sidebar.account.signedOut"))}
              </span>
            </button>
            {accountMenu.isOpen ? (
              <PopoverSurface className="sidebar-account-popover" role="menu">
                {popoverView === "usage" ? (
                  <>
                    <button
                      type="button"
                      className="ghost sidebar-account-back"
                      onClick={handleBackToMenu}
                      aria-label={String(t("sidebar.account.backToMenu"))}
                    >
                      <ChevronLeft size={14} aria-hidden />
                      {String(t("sidebar.account.usage"))}
                    </button>
                    <div className="sidebar-account-separator" role="separator" />
                    <div className="sidebar-usage-panel">
                      <UsagePanel quotas={quotas} loading={quotasLoading} />
                    </div>
                    <div className="sidebar-account-separator" role="separator" />
                    <PopoverMenuItem
                      className="sidebar-account-menu-item"
                      icon={<LogOut size={18} aria-hidden />}
                      onClick={handleLogout}
                    >
                      {isLoggingOut
                        ? String(t("sidebar.account.loggingOut"))
                        : String(t("sidebar.account.logout"))}
                    </PopoverMenuItem>
                  </>
                ) : (
                  <>
                    <div className="sidebar-account-status" role="presentation">
                      <UserCircle size={16} aria-hidden />
                      <span>{loginStatusLabel}</span>
                    </div>
                    <div className="sidebar-account-separator" role="separator" />
                    {user ? (
                      <>
                        <PopoverMenuItem
                          className="sidebar-account-menu-item"
                          icon={<ExternalLink size={18} aria-hidden />}
                          onClick={handleUpgradePlan}
                        >
                          {String(t("sidebar.account.upgrade"))}
                        </PopoverMenuItem>

                        <PopoverMenuItem
                          className="sidebar-account-menu-item"
                          icon={<UserCircle size={18} aria-hidden />}
                          onClick={handleShowUsage}
                        >
                          {String(t("sidebar.account.usage"))}
                        </PopoverMenuItem>
                      </>
                    ) : (
                      <PopoverMenuItem
                        className="sidebar-account-menu-item"
                        icon={<LogIn size={18} aria-hidden />}
                        onClick={handleLogin}
                      >
                        {String(t("sidebar.account.login"))}
                      </PopoverMenuItem>
                    )}
                    <PopoverMenuItem
                      className="sidebar-account-menu-item"
                      icon={<Settings size={18} aria-hidden />}
                      onClick={handleOpenSettings}
                      active
                    >
                      {String(t("actions.settings"))}
                    </PopoverMenuItem>
                    {user ? (
                      <PopoverMenuItem
                        className="sidebar-account-menu-item"
                        icon={<LogOut size={18} aria-hidden />}
                        onClick={handleLogout}
                      >
                        {isLoggingOut
                          ? String(t("sidebar.account.loggingOut"))
                          : String(t("sidebar.account.logout"))}
                      </PopoverMenuItem>
                    ) : null}
                  </>
                )}
              </PopoverSurface>
            ) : null}
          </div>
          <div className="sidebar-utility-inline">
            {user ? (
              <QuotaRing
                percent={dailyQuotaPercent}
                onClick={refreshQuotas}
                tooltip={
                  <div className="sidebar-usage-panel">
                    <UsagePanel quotas={quotas} loading={quotasLoading} />
                  </div>
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
