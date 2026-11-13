import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from './routing';

type Messages = { [k: string]: string | Messages };

const API_URL = process.env.API_URL ?? 'http://localhost:8000';

/** Fill any missing key with the Japanese text, so a half-translated locale never shows raw keys. */
function withFallback(base: Messages, over: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      typeof v === 'object' && v !== null && typeof b === 'object' && b !== null
        ? withFallback(b, v)
        : v;
  }
  return out;
}

/**
 * Admin-edited strings ({"nav.jobs": "..."}) from the API. Cached and tagged so the admin's
 * "save" can revalidate them instantly (POST /api/revalidate). If the API is down, bundled text is used.
 */
async function overrides(locale: string): Promise<Record<string, string>> {
  try {
    const r = await fetch(`${API_URL}/api/v1/i18n/${locale}`, { next: { revalidate: 300, tags: ['translations'] } });
    return r.ok ? ((await r.json()) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Only replaces keys that already exist as strings: an override can never add or reshape the tree. */
function applyOverrides(messages: Messages, flat: Record<string, string>): Messages {
  const out: Messages = structuredClone(messages);
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let node: Messages | string | undefined = out;
    for (const p of parts.slice(0, -1)) node = typeof node === 'object' ? node[p] : undefined;
    const leaf = parts[parts.length - 1];
    if (node && typeof node === 'object' && typeof node[leaf] === 'string') node[leaf] = value;
  }
  return out;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  // Japanese is both a locale and the fallback base: its overrides apply to the base first.
  const base = applyOverrides(
    (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default as Messages,
    await overrides(DEFAULT_LOCALE),
  );
  const messages =
    locale === DEFAULT_LOCALE
      ? base
      : applyOverrides(
          withFallback(base, (await import(`../../messages/${locale}.json`)).default as Messages),
          await overrides(locale),
        );

  return { locale, messages };
});
