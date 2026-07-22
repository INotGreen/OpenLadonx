import { useEffect, useMemo, useState } from "react";
import Download from "lucide-react/dist/esm/icons/download";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import type { AppSettings } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import {
  getAppBuildType,
  type AppBuildType,
} from "@services/tauri";
import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import type { UpdateState } from "@/features/update/hooks/useUpdater";

type SettingsAboutSectionProps = {
  appSettings: AppSettings;
  onCheckForUpdates?: () => void | Promise<void>;
  updateState?: UpdateState;
  updatesEnabled?: boolean;
  isCheckingForUpdates?: boolean;
};

export function SettingsAboutSection({
  appSettings: _appSettings,
  onCheckForUpdates,
  updateState,
  updatesEnabled = true,
  isCheckingForUpdates = false,
}: SettingsAboutSectionProps) {
  const { t } = useI18nSafe();
  const [appBuildType, setAppBuildType] = useState<AppBuildType | "unknown">("unknown");
  const updateButtonState = useMemo(() => {
    const stage = updateState?.stage ?? "idle";

    if (stage === "checking") {
      return { label: "Checking for updates...", title: "Checking for updates...", icon: <LoaderCircle className="sidebar-refresh-icon spinning" aria-hidden />, disabled: true };
    }

    if (stage === "downloading") {
      const downloadedBytes = updateState?.progress?.downloadedBytes ?? 0;
      const totalBytes = updateState?.progress?.totalBytes;
      const progressLabel = totalBytes && totalBytes > 0
        ? `Downloading update... ${Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))}%`
        : "Downloading update...";
      return { label: progressLabel, title: progressLabel, icon: <LoaderCircle className="sidebar-refresh-icon spinning" aria-hidden />, disabled: true };
    }

    if (stage === "downloaded" || stage === "installing" || stage === "restarting") {
      return {
        label: stage === "downloaded" ? "Restart to update" : "Installing update...",
        title: stage === "downloaded" ? "Restart to update" : "Installing update...",
        icon: <Download className="sidebar-refresh-icon" aria-hidden />,
        disabled: stage !== "downloaded",
      };
    }

    if (stage === "error") {
      const message = updateState?.error?.trim() || "Update failed. Click to try again.";
      return { label: message, title: message, icon: <AlertCircle className="sidebar-refresh-icon is-error" aria-hidden />, disabled: false };
    }

    return { label: String(t("settings.checkForUpdates")), title: String(t("settings.checkForUpdates")), icon: <Download className="sidebar-refresh-icon" aria-hidden />, disabled: false };
  }, [t, updateState]);

  useEffect(() => {
    let active = true;
    const loadBuildType = async () => {
      try {
        const value = await getAppBuildType();
        if (active) {
          setAppBuildType(value);
        }
      } catch {
        if (active) {
          setAppBuildType("unknown");
        }
      }
    };
    void loadBuildType();
    return () => {
      active = false;
    };
  }, []);

  const buildDateValue = __APP_BUILD_DATE__.trim();
  const parsedBuildDate = Date.parse(buildDateValue);
  const buildDateLabel = Number.isNaN(parsedBuildDate)
    ? buildDateValue || "unknown"
    : new Date(parsedBuildDate).toLocaleString();

  return (
    <SettingsSection title={String(t('settings.sections.about'))} subtitle={String(t('settings.aboutDescription'))}>
      <div className="settings-field">
        {onCheckForUpdates && updateState?.stage !== "latest" ? (
          <button
            className="ghost main-header-action sidebar-refresh-toggle ds-tooltip-trigger"
            type="button"
            onClick={() => {
              void onCheckForUpdates();
            }}
            aria-label={updateButtonState.label}
            title={updateButtonState.title}
            data-tooltip={updateButtonState.title}
            data-tooltip-align="end"
            data-tooltip-placement="bottom"
            disabled={!updatesEnabled || isCheckingForUpdates || updateButtonState.disabled}
          >
            {updateButtonState.icon}
          </button>
        ) : null}
        <div className="settings-help">
          {String(t('settings.version'))}: <code>{__APP_VERSION__}</code>
        </div>
        <div className="settings-help">
          {String(t('settings.buildType'))}: <code>{appBuildType}</code>
        </div>
        <div className="settings-help">
          {String(t('settings.branch'))}: <code>{__APP_GIT_BRANCH__ || "unknown"}</code>
        </div>
        <div className="settings-help">
          {String(t('settings.commit'))}: <code>{__APP_COMMIT_HASH__ || "unknown"}</code>
        </div>
        <div className="settings-help">
          {String(t('settings.buildDate'))}: <code>{buildDateLabel}</code>
        </div>
      </div>
    </SettingsSection>
  );
}
