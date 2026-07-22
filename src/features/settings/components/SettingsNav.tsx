import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import Keyboard from "lucide-react/dist/esm/icons/keyboard";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import FileText from "lucide-react/dist/esm/icons/file-text";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Layers from "lucide-react/dist/esm/icons/layers";
import ServerCog from "lucide-react/dist/esm/icons/server-cog";
import Bot from "lucide-react/dist/esm/icons/bot";
import Info from "lucide-react/dist/esm/icons/info";
import { PanelNavItem, PanelNavList } from "@/features/design-system/components/panel/PanelPrimitives";
import type { TokenSection } from "./settingsTypes";
import { useI18nSafe } from "@/hooks/useI18nSafe";

type SettingsNavProps = {
  activeSection: TokenSection;
  onSelectSection: (section: TokenSection) => void;
  showDisclosure?: boolean;
};

export function SettingsNav({
  activeSection,
  onSelectSection,
  showDisclosure = false,
}: SettingsNavProps) {
  const { t } = useI18nSafe(); // 不使用命名空间

  return (
    <aside className="settings-sidebar">
      <PanelNavList className="settings-nav-list">
        <PanelNavItem
          className="settings-nav"
          icon={<TerminalSquare aria-hidden />}
          active={activeSection === "token"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("token")}
        >
          {String(t('settings.sections.token'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<Layers aria-hidden />}
          active={activeSection === "environments"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("environments")}
        >
          {String(t('settings.sections.environments'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<SlidersHorizontal aria-hidden />}
          active={activeSection === "display"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("display")}
        >
          {String(t('settings.sections.display'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<FileText aria-hidden />}
          active={activeSection === "composer"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("composer")}
        >
          {String(t('settings.sections.composer'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<Keyboard aria-hidden />}
          active={activeSection === "shortcuts"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("shortcuts")}
        >
          {String(t('settings.sections.shortcuts'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<ExternalLink aria-hidden />}
          active={activeSection === "open-apps"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("open-apps")}
        >
          {String(t('settings.sections.openApps'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<ServerCog aria-hidden />}
          active={activeSection === "server"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("server")}
        >
          {String(t('settings.sections.server'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<Bot aria-hidden />}
          active={activeSection === "agents"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("agents")}
        >
          {String(t('settings.sections.agents'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<FlaskConical aria-hidden />}
          active={activeSection === "features"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("features")}
        >
          {String(t('settings.sections.features'))}
        </PanelNavItem>
        <PanelNavItem
          className="settings-nav"
          icon={<Info aria-hidden />}
          active={activeSection === "about"}
          showDisclosure={showDisclosure}
          onClick={() => onSelectSection("about")}
        >
          {String(t('settings.sections.about'))}
        </PanelNavItem>
      </PanelNavList>
    </aside>
  );
}
