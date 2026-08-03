import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { resolveLang, t as translate } from './i18n';
import type { LanguageCode } from '../types';

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  lang: string;
  t: TFunc;
}

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  t: (key) => key,
});

export function I18nProvider({ language, children }: { language: LanguageCode; children: ReactNode }) {
  const lang = resolveLang(language);
  const t: TFunc = (key, vars) => {
    let s = translate(lang, key);
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  };
  return <I18nContext.Provider value={{ lang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}