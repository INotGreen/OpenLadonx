import type { CodexFeature } from "@/types";
import {
  SettingsSection,
  SettingsSubsection,
  SettingsToggleRow,
  SettingsToggleSwitch,
} from "@/features/design-system/components/settings/SettingsPrimitives";
import type { SettingsFeaturesSectionProps } from "@settings/hooks/useSettingsFeaturesSection";
import { fileManagerName, openInFileManagerLabel } from "@utils/platformPaths";
import { useI18nSafe } from "@/hooks/useI18nSafe";

const getFeatureDescriptionFallback = (featureName: string, t: (key: string, options?: any) => any): string => {
  const key = `settings.settingsFeatures.featureDescriptions.${featureName}`;
  const translation = t(key);
  // If translation key doesn't exist, return a default message
  if (translation === key) {
    return String(t('settings.settingsFeatures.featureDescriptions.featureKey', { name: featureName }));
  }
  return String(translation);
};

function formatFeatureLabel(feature: CodexFeature): string {
  const displayName = feature.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return feature.name
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function featureSubtitle(feature: CodexFeature, t: (key: string, options?: any) => any): string {
  if (feature.description?.trim()) {
    return feature.description;
  }
  if (feature.announcement?.trim()) {
    return feature.announcement;
  }
  if (feature.stage === "deprecated") {
    return String(t('settings.settingsFeatures.featureDescriptions.deprecated'));
  }
  if (feature.stage === "removed") {
    return String(t('settings.settingsFeatures.featureDescriptions.removed'));
  }
  return getFeatureDescriptionFallback(feature.name, t);
}

export function SettingsFeaturesSection({
  appSettings,
  hasFeatureWorkspace,
  openConfigError,
  featureError,
  featuresLoading,
  featureUpdatingKey,
  stableFeatures,
  experimentalFeatures,
  hasDynamicFeatureRows,
  onOpenConfig,
  onToggleCodexFeature,
  onUpdateAppSettings,
}: SettingsFeaturesSectionProps) {
  const { t } = useI18nSafe();

  return (
    <SettingsSection
      title={String(t('settings.sections.features'))}
      subtitle={String(t('settings.settingsFeatures.subtitle'))}
    >
      <SettingsToggleRow
        title={String(t('settings.settingsFeatures.configFile'))}
        subtitle={String(t('settings.settingsFeatures.configFileHelp', { fileManager: fileManagerName() }))}
      >
        <button type="button" className="ghost" onClick={onOpenConfig}>
          {openInFileManagerLabel()}
        </button>
      </SettingsToggleRow>
      {openConfigError && <div className="settings-help">{openConfigError}</div>}
      <SettingsSubsection
        title={String(t('settings.settingsFeatures.stableFeatures'))}
        subtitle={String(t('settings.settingsFeatures.stableFeaturesHelp'))}
      />
      <SettingsToggleRow
        title={String(t('settings.settingsFeatures.personality'))}
        subtitle={
          <>
            {String(t('settings.settingsFeatures.personalityHelp'))}
          </>
        }
      >
        <select
          id="features-personality-select"
          className="settings-select"
          value={appSettings.personality}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              personality: event.target.value as (typeof appSettings)["personality"],
            })
          }
          aria-label={String(t('settings.settingsFeatures.personality'))}
        >
          <option value="friendly">{String(t('settings.settingsFeatures.friendly'))}</option>
          <option value="pragmatic">{String(t('settings.settingsFeatures.pragmatic'))}</option>
        </select>
      </SettingsToggleRow>
      <SettingsToggleRow
        title={String(t('settings.settingsFeatures.pauseQueuedMessages'))}
        subtitle={String(t('settings.settingsFeatures.pauseQueuedMessagesHelp'))}
      >
        <SettingsToggleSwitch
          pressed={appSettings.pauseQueuedMessagesWhenResponseRequired}
          onClick={() =>
            void onUpdateAppSettings({
              ...appSettings,
              pauseQueuedMessagesWhenResponseRequired:
                !appSettings.pauseQueuedMessagesWhenResponseRequired,
            })
          }
        />
      </SettingsToggleRow>
      {stableFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature, t)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        stableFeatures.length === 0 && (
        <div className="settings-help">{String(t('settings.settingsFeatures.noStableFeatures'))}</div>
      )}
      <SettingsSubsection
        title={String(t('settings.settingsFeatures.experimentalFeatures'))}
        subtitle={String(t('settings.settingsFeatures.experimentalFeaturesHelp'))}
      />
      {experimentalFeatures.map((feature) => (
        <SettingsToggleRow
          key={feature.name}
          title={formatFeatureLabel(feature)}
          subtitle={featureSubtitle(feature, t)}
        >
          <SettingsToggleSwitch
            pressed={feature.enabled}
            onClick={() => onToggleCodexFeature(feature)}
            disabled={featureUpdatingKey === feature.name}
          />
        </SettingsToggleRow>
      ))}
      {hasFeatureWorkspace &&
        !featuresLoading &&
        !featureError &&
        hasDynamicFeatureRows &&
        experimentalFeatures.length === 0 && (
          <div className="settings-help">
            {String(t('settings.settingsFeatures.noExperimentalFeatures'))}
          </div>
        )}
      {featuresLoading && (
        <div className="settings-help">{String(t('settings.settingsFeatures.loadingFeatures'))}</div>
      )}
      {!hasFeatureWorkspace && !featuresLoading && (
        <div className="settings-help">
          {String(t('settings.settingsFeatures.connectWorkspaceHelp'))}
        </div>
      )}
      {featureError && <div className="settings-help">{featureError}</div>}
    </SettingsSection>
  );
}
