import { useEffect, useMemo, useState } from "react";
import type { AccountSnapshot, RateLimitSnapshot } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import { getLadonxApiBaseUrl } from "@services/runtimeDefaults";
import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import {
  getLadonxUserUsageStatistics,
  type UserUsageStatisticsResponse,
  type UserUsageStatisticsRow,
} from "@services/tauri";

export type SettingsAccountSectionProps = {
  activeWorkspaceName: string | null;
  accountInfo: AccountSnapshot | null;
  accountRateLimits: RateLimitSnapshot | null;
  accountSwitching: boolean;
  canSwitchAccount: boolean;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  sessionPercent: number | null;
  weeklyPercent: number | null;
  sessionResetLabel: string | null;
  weeklyResetLabel: string | null;
  creditsLabel: string | null;
  showWeekly: boolean;
};

type AccountMetric = {
  label: string;
  value: string;
  caption?: string | null;
};

type TokenUsageRow = {
  time: string;
  token: string;
  group: string;
  cache: string;
  model: string;
  latency: string;
  input: string;
  output: string;
  cost: string;
};

function formatCreditsBalance(accountRateLimits: RateLimitSnapshot | null) {
  const credits = accountRateLimits?.credits ?? null;
  if (!credits?.hasCredits) {
    return "暂无数据";
  }
  if (credits.unlimited) {
    return "Unlimited";
  }
  const balance = credits.balance?.trim();
  if (!balance) {
    return "暂无数据";
  }
  const numeric = Number.parseFloat(balance);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return balance;
  }
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(numeric);
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "暂无数据";
  }
  const numeric = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return `$${numeric.toFixed(6)}`;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "暂无数据";
  }
  return new Intl.NumberFormat().format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "暂无数据";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatDuration(valueMs: number | null | undefined) {
  if (valueMs === null || valueMs === undefined || !Number.isFinite(valueMs)) {
    return "--";
  }
  if (valueMs >= 1000) {
    return `${(valueMs / 1000).toFixed(1)} s`;
  }
  return `${Math.max(0, Math.round(valueMs))} ms`;
}

function formatPercent(value: number | null) {
  return value === null ? "暂无数据" : `${value}%`;
}

function buildUsageRows({
  accountLabel,
  activeWorkspaceName,
  sessionPercent,
  weeklyPercent,
  showWeekly,
}: {
  accountLabel: string;
  activeWorkspaceName: string | null;
  sessionPercent: number | null;
  weeklyPercent: number | null;
  showWeekly: boolean;
}): TokenUsageRow[] {
  const rows: TokenUsageRow[] = [];

  if (sessionPercent !== null) {
    rows.push({
      time: "当前窗口",
      token: accountLabel,
      group: activeWorkspaceName ?? "未选择工作区",
      cache: "--",
      model: "账户额度",
      latency: "--",
      input: `${sessionPercent}%`,
      output: "--",
      cost: "--",
    });
  }

  if (showWeekly && weeklyPercent !== null) {
    rows.push({
      time: "长期窗口",
      token: accountLabel,
      group: activeWorkspaceName ?? "未选择工作区",
      cache: "--",
      model: "账户额度",
      latency: "--",
      input: `${weeklyPercent}%`,
      output: "--",
      cost: "--",
    });
  }

  return rows;
}

function mapRemoteUsageRow(row: UserUsageStatisticsRow): TokenUsageRow {
  const cacheHitRate =
    row.inputTokens > 0
      ? `${((row.cachedTokens / row.inputTokens) * 100).toFixed(1)}%`
      : "--";
  return {
    time: formatDateTime(row.time),
    token: row.token || "LadonX",
    group: row.group || "--",
    cache: row.cachedTokens
      ? `${cacheHitRate}\n${formatNumber(row.cachedTokens)} tokens`
      : cacheHitRate,
    model: row.model || "--",
    latency: `${formatDuration(row.durationMs)} / ${formatDuration(row.firstTokenMs)}`,
    input: formatNumber(row.inputTokens),
    output: formatNumber(row.outputTokens),
    cost: formatCurrency(row.cost),
  };
}

export function SettingsAccountSection({
  activeWorkspaceName,
  accountInfo,
  accountRateLimits,
  sessionPercent,
  weeklyPercent,
  sessionResetLabel,
  weeklyResetLabel,
  creditsLabel,
  showWeekly,
}: SettingsAccountSectionProps) {
  const { t } = useI18nSafe();
  const [usageStatistics, setUsageStatistics] =
    useState<UserUsageStatisticsResponse | null>(null);
  const [tokenPage, setTokenPage] = useState(1);
  const TOKEN_PAGE_SIZE = 10;

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const response = await getLadonxUserUsageStatistics(
          await getLadonxApiBaseUrl(),
          50,
        );
        if (!canceled) {
          setUsageStatistics(response);
        }
      } catch {
        if (!canceled) {
          setUsageStatistics(null);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  const accountEmail = accountInfo?.email?.trim() ?? "";
  const accountLabel =
    accountEmail ||
    (accountInfo?.type === "apikey"
      ? String(t("settings.account.apiKeyAccount"))
      : String(t("settings.account.noAccountConnected")));
  const remoteSummary = usageStatistics?.data?.summary ?? null;
  const remoteRows = useMemo(
    () => usageStatistics?.data?.rows?.map(mapRemoteUsageRow) ?? [],
    [usageStatistics],
  );

  const metrics: AccountMetric[] = [
    {
      label: "账户余额",
      value:
        remoteSummary?.accountBalance !== undefined
          ? formatCurrency(remoteSummary.accountBalance)
          : creditsLabel ?? formatCreditsBalance(accountRateLimits),
      caption: accountRateLimits?.credits?.hasCredits ? "可用余额" : "等待账户同步",
    },
    {
      label: "累计花费",
      value: formatCurrency(remoteSummary?.totalCost),
      caption: remoteSummary?.lastModelName || accountLabel,
    },
    {
      label: "缓存命中率",
      value:
        remoteSummary?.totalInputTokens !== undefined &&
        remoteSummary.totalInputTokens > 0
          ? `${((remoteSummary.totalCachedTokens / remoteSummary.totalInputTokens) * 100).toFixed(1)}%`
          : "暂无数据",
      caption: remoteSummary
        ? `${formatNumber(remoteSummary.totalCachedTokens)} 缓存 / ${formatNumber(remoteSummary.totalInputTokens)} 输入`
        : "累计缓存命中",
    },
    {
      label: "单日 token 使用量",
      value:
        remoteSummary?.dailyTotalTokens !== undefined
          ? formatNumber(remoteSummary.dailyTotalTokens)
          : formatPercent(sessionPercent),
      caption: remoteSummary
        ? `${formatNumber(remoteSummary.dailyRequests)} 次请求`
        : sessionResetLabel ?? "当前窗口",
    },
    {
      label: "累计 token 使用量",
      value:
        remoteSummary?.totalTokens !== undefined
          ? formatNumber(remoteSummary.totalTokens)
          : formatPercent(showWeekly ? weeklyPercent : null),
      caption: remoteSummary
        ? `${formatNumber(remoteSummary.totalRequests)} 次请求`
        : weeklyResetLabel ?? "长期窗口",
    }

  ];

  const allUsageRows =
    remoteRows.length > 0
      ? remoteRows
      : buildUsageRows({
          accountLabel,
          activeWorkspaceName,
          sessionPercent,
          weeklyPercent,
          showWeekly,
        });

  const totalTokenPages = Math.max(1, Math.ceil(allUsageRows.length / TOKEN_PAGE_SIZE));
  const safeTokenPage = Math.min(tokenPage, totalTokenPages);
  const usageRows = allUsageRows.slice(
    (safeTokenPage - 1) * TOKEN_PAGE_SIZE,
    safeTokenPage * TOKEN_PAGE_SIZE,
  );

  return (
    <SettingsSection className="settings-account-section">
      <div className="settings-account-card settings-account-summary-card">
        <div className="settings-account-card-header">
          <div>
            <div className="settings-account-card-title">账户概览</div>
          </div>
        </div>

        <div className="settings-account-metrics">
          {metrics.map((metric) => (
            <div className="settings-account-metric" key={metric.label}>
              <div className="settings-account-metric-label">{metric.label}</div>
              <div className="settings-account-metric-value">{metric.value}</div>
              {metric.caption ? (
                <div className="settings-account-metric-caption">{metric.caption}</div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="settings-account-card settings-account-usage-card">
        <div className="settings-account-card-header">
          <div>
            <div className="settings-account-card-title">Token 使用情况</div>
            <div className="settings-account-card-subtitle">
              按时间、令牌、分组、缓存、模型、输入、输出和花费查看消耗
            </div>
          </div>
        </div>

        <div className="settings-token-table-wrap">
          <table className="settings-token-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>令牌</th>
                <th>分组</th>
                <th>缓存</th>
                <th>模型</th>
                <th>用时/首字</th>
                <th>输入</th>
                <th>输出</th>
                <th>花费</th>
              </tr>
            </thead>
            <tbody>
              {usageRows.length > 0 ? (
                usageRows.map((row) => (
                  <tr key={`${row.time}-${row.cache}`}>
                    <td>{row.time}</td>
                    <td>{row.token}</td>
                    <td>{row.group}</td>
                    <td className="settings-token-table-multiline">{row.cache}</td>
                    <td>{row.model}</td>
                    <td>{row.latency}</td>
                    <td className="settings-token-table-multiline">{row.input}</td>
                    <td>{row.output}</td>
                    <td>{row.cost}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="settings-token-table-empty" colSpan={9}>
                    暂无 token 使用明细
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {allUsageRows.length > TOKEN_PAGE_SIZE && (
          <div className="settings-token-pagination">
            <button
              type="button"
              className="settings-token-pagination-btn"
              disabled={safeTokenPage <= 1}
              onClick={() => setTokenPage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span className="settings-token-pagination-info">
              {safeTokenPage} / {totalTokenPages}
            </span>
            <button
              type="button"
              className="settings-token-pagination-btn"
              disabled={safeTokenPage >= totalTokenPages}
              onClick={() => setTokenPage((p) => Math.min(totalTokenPages, p + 1))}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
