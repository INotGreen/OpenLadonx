import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';

export function useI18nSafe(namespace?: string) {
  const { t, i18n } = useTranslation(namespace);

  const tSafe = useCallback((key: string, options?: any): string => {
    try {
      const result = t(key, options);
      if (typeof result === 'string') {
        if (result === key) {
          console.warn(`Translation missing for key: ${key}, namespace: ${namespace}`);
        }
        return result;
      }
      return key;
    } catch (error) {
      console.warn(`Translation error for key: ${key}, namespace: ${namespace}`, error);
      return key;
    }
  }, [t, namespace]);

  return {
    t: tSafe,
    i18n,
    currentLanguage: i18n.language as 'en' | 'zh',
  };
}