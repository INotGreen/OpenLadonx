import type { ReactNode } from "react";
import FolderKanban from "lucide-react/dist/esm/icons/folder-kanban";
import House from "lucide-react/dist/esm/icons/house";
import MessagesSquare from "lucide-react/dist/esm/icons/messages-square";
import Settings from "lucide-react/dist/esm/icons/settings";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import { useI18nSafe } from "@/hooks/useI18nSafe";

type TabKey = "home" | "projects" | "chat" | "git" | "log";

type TabBarProps = {
  activeTab: TabKey;
  onSelect: (tab: TabKey) => void;
  onOpenSettings?: () => void;
};

const tabConfig: { id: TabKey; icon: ReactNode }[] = [
  { id: "home", icon: <House className="tabbar-icon" /> },
  { id: "projects", icon: <FolderKanban className="tabbar-icon" /> },
  { id: "chat", icon: <MessagesSquare className="tabbar-icon" /> },
  { id: "log", icon: <TerminalSquare className="tabbar-icon" /> },
];

export function TabBar({ activeTab, onSelect, onOpenSettings }: TabBarProps) {
  const { t } = useI18nSafe();

  const tabs = tabConfig.map(tab => ({
    ...tab,
    label: String(t(`tabbar.${tab.id}`))
  }));

  return (
    <nav className="tabbar" aria-label="Primary">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tabbar-item ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onSelect(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
        >
          {tab.icon}
          <span className="tabbar-label">{tab.label}</span>
        </button>
      ))}
      {onOpenSettings && (
        <button
          type="button"
          className="tabbar-item tabbar-item--settings"
          onClick={onOpenSettings}
          aria-label={String(t("actions.settings"))}
        >
          <Settings className="tabbar-icon" />
          <span className="tabbar-label">{String(t("actions.settings"))}</span>
        </button>
      )}
    </nav>
  );
}
