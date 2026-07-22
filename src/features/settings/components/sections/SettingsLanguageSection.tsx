import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";
import { useI18nSafe } from "@/hooks/useI18nSafe";
import type { AppSettings } from "@/types";

type SettingsLanguageSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

export function SettingsLanguageSection({
  appSettings,
  onUpdateAppSettings,
}: SettingsLanguageSectionProps) {
  const { t } = useI18nSafe(); // 不使用命名空间

  const languages = [
    { value: 'en' as const, label: 'English' },
    { value: 'zh' as const, label: '中文' },
  ];

  const handleLanguageChange = async (language: "en" | "zh") => {
    const updated = {
      ...appSettings,
      language
    };
    await onUpdateAppSettings(updated);
    // Change i18n language immediately
    import('@/i18n').then(({ default: i18n }) => {
      i18n.changeLanguage(language);
    });
  };

  return (
    <SettingsSection title={String(t('settings.language'))}>
      <div className="settings-field">
        <label className="settings-field-label">{String(t('settings.languageDescription'))}</label>
        <div className="settings-language-selector">
          {languages.map(lang => (
            <button
              key={lang.value}
              className={`settings-language-button ${appSettings.language === lang.value ? 'active' : ''}`}
              onClick={() => handleLanguageChange(lang.value)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}