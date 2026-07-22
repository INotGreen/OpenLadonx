import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import { useTranslation } from "react-i18next";

export type SidebarToggleProps = {
  isCompact: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCollapseRightPanel: () => void;
  onExpandRightPanel: () => void;
};

export function SidebarCollapseButton({
  isCompact,
  sidebarCollapsed,
  onCollapseSidebar,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact || sidebarCollapsed) {
    return null;
  }
  const label = t("sidebar.collapseSidebar");
  return (
    <button
      type="button"
      className="ghost main-header-action ds-tooltip-trigger"
      onClick={onCollapseSidebar}
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      data-tooltip={label}
      data-tooltip-placement="bottom"
    >
      <PanelLeftClose size={14} aria-hidden />
    </button>
  );
}

export function SidebarExpandButton({
  isCompact,
  sidebarCollapsed,
  onExpandSidebar,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact || !sidebarCollapsed) {
    return null;
  }
  const label = t("sidebar.expandSidebar");
  return (
    <button
      type="button"
      className="ghost main-header-action ds-tooltip-trigger"
      onClick={onExpandSidebar}
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      data-tooltip={label}
      data-tooltip-placement="bottom"
    >
      <PanelLeftOpen size={14} aria-hidden />
    </button>
  );
}

export function RightPanelCollapseButton({
  isCompact,
  rightPanelCollapsed,
  onCollapseRightPanel,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact || rightPanelCollapsed) {
    return null;
  }
  const label = t("sidebar.collapsePreview");
  return (
    <button
      type="button"
      className="ghost main-header-action main-header-action-right ds-tooltip-trigger"
      onClick={onCollapseRightPanel}
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      data-tooltip={label}
      data-tooltip-placement="bottom"
    >
      <PanelRightClose size={14} aria-hidden />
    </button>
  );
}

export function RightPanelExpandButton({
  isCompact,
  rightPanelCollapsed,
  onExpandRightPanel,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact || !rightPanelCollapsed) {
    return null;
  }
  const label = t("sidebar.expandPreview");
  return (
    <button
      type="button"
      className="ghost main-header-action main-header-action-right ds-tooltip-trigger"
      onClick={onExpandRightPanel}
      data-tauri-drag-region="false"
      aria-label={label}
      title={label}
      data-tooltip={label}
      data-tooltip-placement="bottom"
    >
      <PanelRightOpen size={14} aria-hidden />
    </button>
  );
}

export function TitlebarExpandControls({
  isCompact,
  sidebarCollapsed,
  onExpandSidebar,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact || !sidebarCollapsed) {
    return null;
  }
  const label = t("sidebar.expandSidebar");
  return (
    <div className="titlebar-controls">
      {sidebarCollapsed && (
        <div className="titlebar-toggle titlebar-toggle-left">
          <button
            type="button"
            className="ghost main-header-action ds-tooltip-trigger"
            onClick={onExpandSidebar}
            data-tauri-drag-region="false"
            aria-label={label}
            title={label}
            data-tooltip={label}
            data-tooltip-placement="bottom"
          >
            <PanelLeftOpen size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
