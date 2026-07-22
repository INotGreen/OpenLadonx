import type { AppSettings } from "@/types";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import {
  SettingsSection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";

type ComposerPreset = AppSettings["composerEditorPreset"];

type SettingsComposerSectionProps = {
  appSettings: AppSettings;
  optionKeyLabel: string;
  composerPresetLabels: Record<ComposerPreset, string>;
  onComposerPresetChange: (preset: ComposerPreset) => void;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

export function SettingsComposerSection({
  appSettings,
  optionKeyLabel,
  composerPresetLabels,
  onComposerPresetChange,
  onUpdateAppSettings,
}: SettingsComposerSectionProps) {
  const { t } = useI18nSafe();
  const steerUnavailable = !appSettings.steerEnabled;
  return (
    <SettingsSection
      title={String(t("settings.settingsComposer.title"))}
      subtitle={String(t("settings.settingsComposer.subtitle"))}
    >
      <div className="settings-field">
        {/* <div className="settings-field-label">Follow-up behavior</div>
        <div className={`settings-segmented${appSettings.followUpMessageBehavior === "steer" ? " is-second-active" : ""}`} aria-label="Follow-up behavior">
          <label
            className={`settings-segmented-option${
              appSettings.followUpMessageBehavior === "queue" ? " is-active" : ""
            }`}
          >
            <input
              className="settings-segmented-input"
              type="radio"
              name="follow-up-behavior"
              value="queue"
              checked={appSettings.followUpMessageBehavior === "queue"}
              onChange={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  followUpMessageBehavior: "queue",
                })
              }
            />
            <span className="settings-segmented-option-label">Queue</span>
          </label>
          <label
            className={`settings-segmented-option${
              appSettings.followUpMessageBehavior === "steer" ? " is-active" : ""
            }${steerUnavailable ? " is-disabled" : ""}`}
            title={steerUnavailable ? "Steer is unavailable in the current Codex config." : ""}
          >
            <input
              className="settings-segmented-input"
              type="radio"
              name="follow-up-behavior"
              value="steer"
              checked={appSettings.followUpMessageBehavior === "steer"}
              disabled={steerUnavailable}
              onChange={() => {
                if (steerUnavailable) {
                  return;
                }
                void onUpdateAppSettings({
                  ...appSettings,
                  followUpMessageBehavior: "steer",
                });
              }}
            />
            <span className="settings-segmented-option-label">Steer</span>
          </label>
        </div> */}
        {steerUnavailable && (
          <div className="settings-help">
            {String(t("settings.settingsComposer.steerUnavailable"))}
          </div>
        )}
      </div>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{String(t("settings.settingsComposer.presets"))}</div>
      <div className="settings-subsection-subtitle">
        {String(t("settings.settingsComposer.presetsSubtitle"))}
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="composer-preset">
          {String(t("settings.settingsComposer.preset"))}
        </label>
        <select
          id="composer-preset"
          className="settings-select"
          value={appSettings.composerEditorPreset}
          onChange={(event) =>
            onComposerPresetChange(event.target.value as ComposerPreset)
          }
        >
          {Object.entries(composerPresetLabels).map(([preset, label]) => (
            <option key={preset} value={preset}>
              {label}
            </option>
          ))}
        </select>
        <div className="settings-help">
        </div>
      </div>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{String(t("settings.settingsComposer.codeFences"))}</div>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.expandFencesOnSpace"))}
        subtitle={String(t("settings.settingsComposer.expandFencesOnSpaceSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceExpandOnSpace}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceExpandOnSpace: !appSettings.composerFenceExpandOnSpace,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.expandFencesOnEnter"))}
        subtitle={String(t("settings.settingsComposer.expandFencesOnEnterSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceExpandOnEnter}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceExpandOnEnter: !appSettings.composerFenceExpandOnEnter,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.supportLanguageTags"))}
        subtitle={String(t("settings.settingsComposer.supportLanguageTagsSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceLanguageTags}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceLanguageTags: !appSettings.composerFenceLanguageTags,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.wrapSelectionInFences"))}
        subtitle={String(t("settings.settingsComposer.wrapSelectionInFencesSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceWrapSelection}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceWrapSelection: !appSettings.composerFenceWrapSelection,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.copyBlocksWithoutFences"))}
        subtitle={String(t("settings.settingsComposer.copyBlocksWithoutFencesSubtitle", { optionKey: optionKeyLabel }))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerCodeBlockCopyUseModifier}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerCodeBlockCopyUseModifier:
                !appSettings.composerCodeBlockCopyUseModifier,
            })
          }
        />
      </SettingsToggleRow>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{String(t("settings.settingsComposer.pasting"))}</div>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.autoWrapMultilinePaste"))}
        subtitle={String(t("settings.settingsComposer.autoWrapMultilinePasteSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceAutoWrapPasteMultiline}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceAutoWrapPasteMultiline:
                !appSettings.composerFenceAutoWrapPasteMultiline,
            })
          }
        />
      </SettingsToggleRow>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.autoWrapCodeLikeSingleLines"))}
        subtitle={String(t("settings.settingsComposer.autoWrapCodeLikeSingleLinesSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerFenceAutoWrapPasteCodeLike}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerFenceAutoWrapPasteCodeLike:
                !appSettings.composerFenceAutoWrapPasteCodeLike,
            })
          }
        />
      </SettingsToggleRow>
      <div className="settings-divider" />
      <div className="settings-subsection-title">{String(t("settings.settingsComposer.lists"))}</div>
      <SettingsToggleRow
        title={String(t("settings.settingsComposer.continueListsOnShiftEnter"))}
        subtitle={String(t("settings.settingsComposer.continueListsOnShiftEnterSubtitle"))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.composerListContinuation}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              composerListContinuation: !appSettings.composerListContinuation,
            })
          }
        />
      </SettingsToggleRow>
    </SettingsSection>
  );
}
