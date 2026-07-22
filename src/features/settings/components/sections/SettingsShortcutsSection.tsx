import { useMemo, useState, type KeyboardEvent } from "react";
import {
  SettingsSection,
  SettingsSubsection,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import { formatShortcut, getDefaultInterruptShortcut } from "@utils/shortcuts";
import { isMacPlatform } from "@utils/platformPaths";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type {
  ShortcutDraftKey,
  ShortcutDrafts,
  ShortcutSettingKey,
} from "@settings/components/settingsTypes";

type ShortcutItem = {
  label: string;
  draftKey: ShortcutDraftKey;
  settingKey: ShortcutSettingKey;
  help: string;
};

type ShortcutGroup = {
  title: string;
  subtitle: string;
  items: ShortcutItem[];
};

type SettingsShortcutsSectionProps = {
  shortcutDrafts: ShortcutDrafts;
  onShortcutKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    key: ShortcutSettingKey,
  ) => void;
  onClearShortcut: (key: ShortcutSettingKey) => void;
};

function ShortcutField({
  item,
  shortcutDrafts,
  onShortcutKeyDown,
  onClearShortcut,
  t,
}: {
  item: ShortcutItem;
  shortcutDrafts: ShortcutDrafts;
  onShortcutKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
    key: ShortcutSettingKey,
  ) => void;
  onClearShortcut: (key: ShortcutSettingKey) => void;
  t: (key: string, options?: any) => any;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field-label">{item.label}</div>
      <div className="settings-field-row">
        <input
          className="settings-input settings-input--shortcut"
          value={formatShortcut(shortcutDrafts[item.draftKey])}
          onKeyDown={(event) => onShortcutKeyDown(event, item.settingKey)}
          placeholder={String(t('settings.settingsShortcuts.typeShortcut'))}
          readOnly
        />
        <button
          type="button"
          className="ghost settings-button-compact"
          onClick={() => onClearShortcut(item.settingKey)}
        >
          {String(t('settings.settingsShortcuts.clear'))}
        </button>
      </div>
      <div className="settings-help">{item.help}</div>
    </div>
  );
}

export function SettingsShortcutsSection({
  shortcutDrafts,
  onShortcutKeyDown,
  onClearShortcut,
}: SettingsShortcutsSectionProps) {
  const { t } = useI18nSafe();
  const isMac = isMacPlatform();
  const [searchQuery, setSearchQuery] = useState("");

  const groups = useMemo<ShortcutGroup[]>(
    () => [
      {
        title: String(t('settings.settingsShortcuts.file')),
        subtitle: String(t('settings.settingsShortcuts.fileHelp')),
        items: [
          {
            label: String(t('settings.settingsShortcuts.newAgent')),
            draftKey: "newAgent",
            settingKey: "newAgentShortcut",
            help: String(t('settings.settingsShortcuts.newAgentHelp', { shortcut: formatShortcut("cmd+n") })),
          },
          {
            label: String(t('settings.settingsShortcuts.newWorktreeAgent')),
            draftKey: "newWorktreeAgent",
            settingKey: "newWorktreeAgentShortcut",
            help: String(t('settings.settingsShortcuts.newWorktreeAgentHelp', { shortcut: formatShortcut("cmd+shift+n") })),
          },
          {
            label: String(t('settings.settingsShortcuts.newCloneAgent')),
            draftKey: "newCloneAgent",
            settingKey: "newCloneAgentShortcut",
            help: String(t('settings.settingsShortcuts.newCloneAgentHelp', { shortcut: formatShortcut("cmd+alt+n") })),
          },
          {
            label: String(t('settings.settingsShortcuts.archiveActiveThread')),
            draftKey: "archiveThread",
            settingKey: "archiveThreadShortcut",
            help: String(t('settings.settingsShortcuts.archiveActiveThreadHelp', { shortcut: formatShortcut(isMac ? "cmd+ctrl+a" : "ctrl+alt+a") })),
          },
        ],
      },
      {
        title: String(t('settings.settingsShortcuts.composer')),
        subtitle: String(t('settings.settingsShortcuts.composerHelp')),
        items: [
          {
            label: String(t('settings.settingsShortcuts.cycleModel')),
            draftKey: "model",
            settingKey: "composerModelShortcut",
            help: String(t('settings.settingsShortcuts.cycleModelHelp', { shortcut: formatShortcut("cmd+shift+m") })),
          },
          {
            label: String(t('settings.settingsShortcuts.cycleAccessMode')),
            draftKey: "access",
            settingKey: "composerAccessShortcut",
            help: String(t('settings.settingsShortcuts.cycleAccessModeHelp', { shortcut: formatShortcut("cmd+shift+a") })),
          },
          {
            label: String(t('settings.settingsShortcuts.cycleReasoningMode')),
            draftKey: "reasoning",
            settingKey: "composerReasoningShortcut",
            help: String(t('settings.settingsShortcuts.cycleReasoningModeHelp', { shortcut: formatShortcut("cmd+shift+r") })),
          },
          {
            label: String(t('settings.settingsShortcuts.cycleCollaborationMode')),
            draftKey: "collaboration",
            settingKey: "composerCollaborationShortcut",
            help: String(t('settings.settingsShortcuts.cycleCollaborationModeHelp', { shortcut: formatShortcut("shift+tab") })),
          },
          {
            label: String(t('settings.settingsShortcuts.stopActiveRun')),
            draftKey: "interrupt",
            settingKey: "interruptShortcut",
            help: String(t('settings.settingsShortcuts.stopActiveRunHelp', { shortcut: formatShortcut(getDefaultInterruptShortcut()) })),
          },
        ],
      },
      {
        title: String(t('settings.settingsShortcuts.panels')),
        subtitle: String(t('settings.settingsShortcuts.panelsHelp')),
        items: [
          {
            label: String(t('settings.settingsShortcuts.toggleProjectsSidebar')),
            draftKey: "projectsSidebar",
            settingKey: "toggleProjectsSidebarShortcut",
            help: String(t('settings.settingsShortcuts.toggleProjectsSidebarHelp', { shortcut: formatShortcut("cmd+shift+p") })),
          },
          {
            label: String(t('settings.settingsShortcuts.toggleDebugPanel')),
            draftKey: "debugPanel",
            settingKey: "toggleDebugPanelShortcut",
            help: String(t('settings.settingsShortcuts.toggleDebugPanelHelp', { shortcut: formatShortcut("cmd+shift+d") })),
          },
        ],
      },
      {
        title: String(t('settings.settingsShortcuts.navigation')),
        subtitle: String(t('settings.settingsShortcuts.navigationHelp')),
        items: [
          {
            label: String(t('settings.settingsShortcuts.nextAgent')),
            draftKey: "cycleAgentNext",
            settingKey: "cycleAgentNextShortcut",
            help: String(t('settings.settingsShortcuts.nextAgentHelp', { shortcut: formatShortcut(isMac ? "cmd+ctrl+down" : "ctrl+alt+down") })),
          },
          {
            label: String(t('settings.settingsShortcuts.previousAgent')),
            draftKey: "cycleAgentPrev",
            settingKey: "cycleAgentPrevShortcut",
            help: String(t('settings.settingsShortcuts.previousAgentHelp', { shortcut: formatShortcut(isMac ? "cmd+ctrl+up" : "ctrl+alt+up") })),
          },
          {
            label: String(t('settings.settingsShortcuts.nextWorkspace')),
            draftKey: "cycleWorkspaceNext",
            settingKey: "cycleWorkspaceNextShortcut",
            help: String(t('settings.settingsShortcuts.nextWorkspaceHelp', { shortcut: formatShortcut(isMac ? "cmd+shift+down" : "ctrl+alt+shift+down") })),
          },
          {
            label: String(t('settings.settingsShortcuts.previousWorkspace')),
            draftKey: "cycleWorkspacePrev",
            settingKey: "cycleWorkspacePrevShortcut",
            help: String(t('settings.settingsShortcuts.previousWorkspaceHelp', { shortcut: formatShortcut(isMac ? "cmd+shift+up" : "ctrl+alt+shift+up") })),
          },
        ],
      },
    ],
    [isMac, t],
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedSearchQuery) {
      return groups;
    }
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const searchValue = `${group.title} ${group.subtitle} ${item.label} ${item.help}`.toLowerCase();
          return searchValue.includes(normalizedSearchQuery);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, normalizedSearchQuery]);

  return (
    <SettingsSection
      title={String(t('settings.sections.shortcuts'))}
      subtitle={String(t('settings.settingsShortcuts.subtitle'))}
    >
      <div className="settings-field settings-shortcuts-search">
        <label className="settings-field-label" htmlFor="settings-shortcuts-search">
          {String(t('settings.settingsShortcuts.searchShortcuts'))}
        </label>
        <div className="settings-field-row">
          <input
            id="settings-shortcuts-search"
            className="settings-input"
            placeholder={String(t('settings.settingsShortcuts.searchShortcutsPlaceholder'))}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="ghost settings-button-compact"
              onClick={() => setSearchQuery("")}
            >
              {String(t('settings.settingsShortcuts.clear'))}
            </button>
          )}
        </div>
        <div className="settings-help">{String(t('settings.settingsShortcuts.filterHelp'))}</div>
      </div>
      {filteredGroups.map((group, index) => (
        <div key={group.title}>
          {index > 0 && <div className="settings-divider" />}
          <SettingsSubsection title={group.title} subtitle={group.subtitle} />
          {group.items.map((item) => (
            <ShortcutField
              key={item.settingKey}
              item={item}
              shortcutDrafts={shortcutDrafts}
              onShortcutKeyDown={onShortcutKeyDown}
              onClearShortcut={onClearShortcut}
              t={t}
            />
          ))}
        </div>
      ))}
      {filteredGroups.length === 0 && (
        <div className="settings-empty">
          {String(t('settings.settingsShortcuts.noShortcutsMatch', {
            search: normalizedSearchQuery ? `"${searchQuery.trim()}"` : String(t('settings.settingsShortcuts.noShortcutsMatchDefault'))
          }))}
        </div>
      )}
    </SettingsSection>
  );
}
