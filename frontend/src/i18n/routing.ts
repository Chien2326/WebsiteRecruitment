import { defineRouting } from 'next-intl/routing';

export const LOCALES = ['ja', 'en', 'vi', 'my', 'ne', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ja';

/** Endonyms: each language is shown in its own script so users can find it. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
  vi: 'Tiếng Việt',
  my: 'မြန်မာ',
  ne: 'नेपाली',
  bn: 'বাংলা',
};

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // Always prefix (/ja/..., /en/...): clean SEO/hreflang, and it makes the
  // Accept-Language redirect on first visit unambiguous.
  localePrefix: 'always',
  // First visit: Accept-Language negotiation. After that the NEXT_LOCALE
  // cookie (set when the user picks a language) wins.
  localeDetection: true,
  localeCookie: { name: 'NEXT_LOCALE', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' },
});

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}
