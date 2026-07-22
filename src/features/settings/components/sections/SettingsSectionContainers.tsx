import { SettingsApiKeyManager } from "./SettingsApiKeyManager";
import { SettingsComposerSection } from "./SettingsComposerSection";
import { SettingsDisplaySection } from "./SettingsDisplaySection";
import { SettingsEnvironmentsSection } from "./SettingsEnvironmentsSection";
import { SettingsFeaturesSection } from "./SettingsFeaturesSection";
import { SettingsOpenAppsSection } from "./SettingsOpenAppsSection";
import { SettingsServerSection } from "./SettingsServerSection";
import { SettingsShortcutsSection } from "./SettingsShortcutsSection";
import { SettingsAgentsSection } from "./SettingsAgentsSection";
import { SettingsAboutSection } from "./SettingsAboutSection";
import type { TokenSection } from "@settings/components/settingsTypes";
import type { SettingsViewOrchestration } from "@settings/hooks/useSettingsViewOrchestration";

type SettingsSectionContainersProps = {
  activeSection: TokenSection;
  orchestration: SettingsViewOrchestration;
};

export function SettingsSectionContainers({
  activeSection,
  orchestration,
}: SettingsSectionContainersProps) {
  if (activeSection === "account") {
    return <SettingsApiKeyManager {...orchestration.codexSectionProps} />;
  }
  if (activeSection === "environments") {
    return <SettingsEnvironmentsSection {...orchestration.environmentsSectionProps} />;
  }
  if (activeSection === "display") {
    return <SettingsDisplaySection {...orchestration.displaySectionProps} />;
  }
  if (activeSection === "about") {
    return <SettingsAboutSection {...orchestration.aboutSectionProps} />;
  }
  if (activeSection === "composer") {
    return <SettingsComposerSection {...orchestration.composerSectionProps} />;
  }
  if (activeSection === "shortcuts") {
    return <SettingsShortcutsSection {...orchestration.shortcutsSectionProps} />;
  }
  if (activeSection === "git") {
    return <SettingsShortcutsSection {...orchestration.shortcutsSectionProps} />;
  }
  if (activeSection === "open-apps") {
    return <SettingsOpenAppsSection {...orchestration.openAppsSectionProps} />;
  }
  if (activeSection === "server") {
    return <SettingsServerSection {...orchestration.serverSectionProps} />;
  }
  if (activeSection === "agents") {
    return <SettingsAgentsSection {...orchestration.agentsSectionProps} />;
  }
  if (activeSection === "token") {
    return <SettingsApiKeyManager {...orchestration.codexSectionProps} />;
  }
  if (activeSection === "features") {
    return <SettingsFeaturesSection {...orchestration.featuresSectionProps} />;
  }
  return null;
}
