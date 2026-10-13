import { useSyncExternalStore } from 'react';
import { english, arabic } from './messages';
import { generatedEnglish } from './generated';
import { interfaceArabic } from './interface-arabic';
export type Locale = 'en' | 'ar';
export const currentLocale = () => locale;
export type TranslationKey = keyof typeof english | keyof typeof generatedEnglish;
let locale: Locale = 'en';
const listeners = new Set<() => void>();
const catalog: Record<string, string> = { ...generatedEnglish, ...english };
export function hasLocalePreference() {
  try {
    return localStorage.getItem('dentalai.locale') !== null;
  } catch {
    return false;
  }
}
try {
  if (localStorage.getItem('dentalai.locale') === 'ar') locale = 'ar';
} catch {
  /* Private storage may be unavailable. */
}
export function setLocale(value: Locale, persist = true) {
  locale = value;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value;
    document.documentElement.dir = value === 'ar' ? 'rtl' : 'ltr';
  }
  if (persist)
    try {
      localStorage.setItem('dentalai.locale', value);
    } catch {
      /* Locale still works in memory. */
    }
  listeners.forEach((listener) => listener());
}
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => locale,
    () => 'en' as const,
  );
}
export function t(key: TranslationKey, values: Record<string, string | number> = {}) {
  const translated: Partial<Record<string, string>> = arabic;
  const source = catalog[key];
  const message =
    (locale === 'ar'
      ? (translated[key] ?? (source ? interfaceArabic[source] : undefined))
      : undefined) ?? source;
  if (message === undefined) throw new Error(`Missing translation key: ${key}`);
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]),
  );
}
