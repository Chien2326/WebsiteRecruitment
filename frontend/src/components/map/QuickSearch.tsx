'use client';

import { useState, type FormEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ChevronDown, MapPin, Search } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { REGION_CODES, isPrefectureActive, isRegionActive, placeName, prefecturesOf, type PlacesInfo } from '@/lib/japan';
import type { PrefectureCounts } from '@/lib/job';
import { latn } from '@/lib/format';

type Props = {
  counts: PrefectureCounts | null;
  defaultPrefecture?: number;
  defaultQ?: string;
  places?: PlacesInfo | null;
};

/**
 * Keyword + prefecture search. A plain GET form underneath (works without JS / before hydration);
 * with JS it navigates client-side. Native <select> on purpose: on phones it opens the OS picker,
 * which is the most familiar control for every user language.
 */
export default function QuickSearch({ counts, defaultPrefecture, defaultQ, places }: Props) {
  const t = useTranslations('search');
  const tr = useTranslations('regions');
  const locale = useLocale();
  const format = latn(useFormatter());
  const router = useRouter();
  const [q, setQ] = useState(defaultQ ?? '');
  const [pref, setPref] = useState(defaultPrefecture ? String(defaultPrefecture) : '');

  function submit(e: FormEvent) {
    e.preventDefault();
    const query: Record<string, string> = {};
    const kw = q.trim().slice(0, 100);
    if (kw) query.q = kw;
    if (pref) query.prefecture = pref;
    router.push({ pathname: '/jobs', query });
  }

  // text-base (16px) on inputs: prevents iOS Safari from zooming the page on focus
  const field =
    'min-h-[48px] w-full rounded-xl border border-slate-200 bg-white pl-10 text-base text-slate-800 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

  return (
    <form
      role="search"
      action={`/${locale}/jobs`}
      method="get"
      onSubmit={submit}
      className="grid gap-2 rounded-2xl bg-white p-3 shadow-md ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_auto]"
    >
      <label className="relative block">
        <span className="sr-only">{t('keywordLabel')}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={100}
          enterKeyHint="search"
          placeholder={t('keywordPlaceholder')}
          className={`${field} pr-3`}
        />
      </label>

      <label className="relative block">
        <span className="sr-only">{t('prefectureLabel')}</span>
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-brand" aria-hidden />
        <select
          name="prefecture"
          value={pref}
          onChange={(e) => setPref(e.target.value)}
          className={`${field} appearance-none pr-9`}
        >
          <option value="">{t('anyPrefecture')}</option>
          {REGION_CODES.filter((r) => isRegionActive(r, places)).map((r) => (
            <optgroup key={r} label={places?.regions[r]?.name?.[locale] || tr(r)}>
              {prefecturesOf(r).filter((p) => isPrefectureActive(p, places)).map((p) => (
                <option key={p.id} value={p.id}>
                  {placeName(p, locale, places)}
                  {counts ? ` (${format.number(counts[p.id] ?? 0)})` : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      </label>

      <button
        type="submit"
        className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand px-6 font-bold text-white hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <Search className="h-5 w-5" aria-hidden />
        {t('submit')}
      </button>
    </form>
  );
}
