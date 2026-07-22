import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTranslations from './locales/en/translation.json';
import zhTranslations from './locales/zh/translation.json';

const resources = {
  en: {
    translation: enTranslations,
  },
  zh: {
    translation: zhTranslations,
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh', // 默认语言为中文
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React已经防范XSS
    },
    react: {
      useSuspense: false, // 避免与现有 Suspense冲突
    },
    debug: false, // 关闭调试模式
  });

export default i18n;