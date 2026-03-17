import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh'],
  hideLocale: 'default-locale',
  parser: 'dot',
});

export type SupportedLanguage = (typeof i18n.languages)[number];

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return i18n.languages.includes(lang as SupportedLanguage);
}

export const DEFAULT_LOCALE = i18n.defaultLanguage;
