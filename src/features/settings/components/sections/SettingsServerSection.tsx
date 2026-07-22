import { useEffect, useState } from "react";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type { AppSettings } from "@/types";
import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import { resolveRelayHostUrlCandidate } from "../../utils/relay";
import { getRelayHostUrl } from "@services/runtimeDefaults";

type SettingsServerSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  isMobilePlatform: boolean;
  mobileConnectBusy: boolean;
  mobileConnectStatusText: string | null;
  mobileConnectStatusError: boolean;
  onMobileConnectTest: () => void;
  desktopConnectBusy: boolean;
  desktopConnectStatusText: string | null;
  desktopConnectStatusError: boolean;
  onDesktopConnectTest: () => void;
};

export function SettingsServerSection({
  appSettings,
  onUpdateAppSettings,
  isMobilePlatform,
  mobileConnectBusy,
  mobileConnectStatusText,
  mobileConnectStatusError,
  onMobileConnectTest,
  desktopConnectBusy,
  desktopConnectStatusText,
  desktopConnectStatusError,
  onDesktopConnectTest,
}: SettingsServerSectionProps) {
  const { t } = useI18nSafe();
  const [defaultRelayHostUrl, setDefaultRelayHostUrl] = useState("");
  useEffect(() => {
    let canceled = false;
    void getRelayHostUrl().then((value) => {
      if (!canceled) {
        setDefaultRelayHostUrl(value);
      }
    });
    return () => {
      canceled = true;
    };
  }, []);
  const resolvedRelayHostUrl = resolveRelayHostUrlCandidate(
    appSettings.remoteBackendWebSocketUrl,
    appSettings.codexBaseUrl,
    defaultRelayHostUrl,
  );

  const [websocketUrlDraft, setWebsocketUrlDraft] = useState(
    resolvedRelayHostUrl
  );
  const [tokenDraft, setTokenDraft] = useState(
    appSettings.remoteBackendToken || ""
  );

  useEffect(() => {
    if (!appSettings.remoteBackendWebSocketUrl?.trim()) {
      setWebsocketUrlDraft(resolvedRelayHostUrl);
    }
  }, [appSettings.remoteBackendWebSocketUrl, resolvedRelayHostUrl]);

  const handleWebsocketUrlChange = (value: string) => {
    setWebsocketUrlDraft(value);
    void onUpdateAppSettings({
      ...appSettings,
      remoteBackendProvider: value.trim() ? "websocket" : appSettings.remoteBackendProvider,
      remoteBackendWebSocketUrl: value || null,
    });
  };

  const handleTokenChange = (value: string) => {
    setTokenDraft(value);
    void onUpdateAppSettings({
      ...appSettings,
      remoteBackendToken: value || null,
    });
  };

  const isMobile = isMobilePlatform;
  const [showToken, setShowToken] = useState(false);

  return (
    <SettingsSection
      title={String(t('settings.sections.server'))}
      subtitle={
        isMobile
          ? "Connect to your desktop backend via WebSocket relay"
          : "WebSocket relay server for mobile clients"
      }
    >
      {/* WebSocket Relay 配置 */}
      <div className="settings-field">
        <div className="settings-field-label">
          {isMobile ? "Desktop Backend" : "WebSocket Relay Server"}
        </div>
        <input
          className="settings-input"
          value={websocketUrlDraft}
          placeholder={resolvedRelayHostUrl}
          onChange={(e) => handleWebsocketUrlChange(e.target.value)}
          aria-label="WebSocket URL"
        />
        <div className="settings-help">
          {isMobile
            ? "Enter your desktop backend's WebSocket relay address"
            : "Mobile clients will connect to this relay server to reach your desktop"}
        </div>
      </div>

      {/* Token 配置 */}
      <div className="settings-field">
        <div className="settings-field-label">Authentication Token</div>
        <div className="settings-input-wrapper" style={{ position: "relative" }}>
          <input
            type={showToken ? "text" : "password"}
            className="settings-input"
            value={tokenDraft}
            placeholder="Enter shared token"
            onChange={(e) => handleTokenChange(e.target.value)}
            aria-label="Authentication Token"
            style={{ paddingRight: "40px" }}
          />
          <button
            type="button"
            className="ghost icon-button"
            onClick={() => setShowToken(!showToken)}
            aria-label={showToken ? "Hide token" : "Show token"}
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              padding: "4px",
            }}
          >
            {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <div className="settings-help">
          A shared secret token for authenticating with the relay server
        </div>
      </div>

      {/* 移动端：连接测试 */}
      {isMobile && (
        <div className="settings-field">
          <div className="settings-field-label">Test Connection</div>
          <button
            type="button"
            className="button"
            onClick={onMobileConnectTest}
            disabled={mobileConnectBusy || !websocketUrlDraft || !tokenDraft}
          >
            {mobileConnectBusy ? "Connecting..." : "Connect & Test"}
          </button>
          {mobileConnectStatusText && (
            <div className={`settings-help${mobileConnectStatusError ? " settings-help-error" : ""}`}>
              {mobileConnectStatusText}
            </div>
          )}
          <div className="settings-help">
            Make sure your desktop app is running with the WebSocket relay enabled
          </div>
        </div>
      )}

      {/* 桌面端：连接测试 */}
      {!isMobile && (
        <div className="settings-field">
          <div className="settings-field-label">Test Relay Connection</div>
          <button
            type="button"
            className="button"
            onClick={onDesktopConnectTest}
            disabled={desktopConnectBusy || !websocketUrlDraft || !tokenDraft}
          >
            {desktopConnectBusy ? "Connecting..." : "Connect & Test"}
          </button>
          {desktopConnectStatusText && (
            <div className={`settings-help${desktopConnectStatusError ? " settings-help-error" : ""}`}>
              {desktopConnectStatusText}
            </div>
          )}
          <div className="settings-help">
            Test your connection to the WebSocket relay server
          </div>
        </div>
      )}

      {/* 帮助信息 */}
      <div className="settings-help">
        <strong>How it works:</strong>
        <ul style={{ margin: "0.5em 0", paddingLeft: "1.5em" }}>
          <li>Desktop app connects to the WebSocket relay server</li>
          <li>Mobile app connects to the same relay server</li>
          <li>The relay forwards messages between desktop and mobile</li>
        </ul>
      </div>
    </SettingsSection>
  );
}
