'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Globe } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/routing';

const YEAR = 60 * 60 * 24 * 365;

export default function LanguageSwitcher() {
  const t = useTranslations('nav');
  const current = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname(); // locale-less path, e.g. /jobs/123
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(next: Locale) {
    setOpen(false);
    if (next === current) return;
    // Persist the manual choice. This cookie beats Accept-Language on every later visit.
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${YEAR}; samesite=lax`;
    try {
      localStorage.setItem('locale', next);
    } catch {
      /* private mode etc. - the cookie is the source of truth */
    }
    startTransition(() => router.replace(pathname, { locale: next }));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language')}
        disabled={pending}
        className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
      >
        <Globe className="h-4 w-4" aria-hidden />
        <span lang={current}>{LOCALE_LABELS[current]}</span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('language')}
          className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {LOCALES.map((l) => (
            <li key={l} role="option" aria-selected={l === current}>
              <button
                type="button"
                lang={l}
                onClick={() => choose(l)}
                className="flex min-h-[44px] w-full items-center justify-between px-4 py-2 text-left text-base hover:bg-brand-light"
              >
                {LOCALE_LABELS[l]}
                {l === current && <Check className="h-4 w-4 text-brand" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
