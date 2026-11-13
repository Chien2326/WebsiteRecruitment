import { getTranslations } from 'next-intl/server';
import { SlidersHorizontal } from 'lucide-react';
import { EMPLOYMENT_TYPES, FEATURE_KEYS, HOURLY_STEPS, LEVELS, localize, type JobSearch, type VisaTypeInfo } from '@/lib/job';

const select = 'min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

/** "Reset filters" keeps the place and keyword chosen on the map / quick search. */
function keepLocation(f: JobSearch): string {
  const q = new URLSearchParams();
  if (f.prefecture) q.set('prefecture', String(f.prefecture));
  else if (f.region) q.set('region', f.region);
  if (f.q) q.set('q', f.q);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Plain GET form (works without JavaScript; the URL is shareable). Location / keyword come from the map and
 * quick search above, and are carried along as hidden fields. Submitting always goes back to page 1.
 */
export default async function JobFilterForm({ f, locale, visas }: { f: JobSearch; locale: string; visas: VisaTypeInfo[] }) {
  const t = await getTranslations('jobsPage.filters');
  const tj = await getTranslations('jobDetail');
  const active = [f.level, f.visa, f.minHourly, f.employment, f.features?.length, f.sort === 'salary'].filter(Boolean).length;

  return (
    <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm" open={active > 0}>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-4 font-bold text-navy">
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-brand" aria-hidden />
          {t('title')}
          {active > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs text-white">{active}</span>}
        </span>
        <span className="text-slate-400 transition group-open:rotate-45" aria-hidden>＋</span>
      </summary>
      <form method="get" action={`/${locale}/jobs`} className="space-y-4 border-t border-slate-100 p-4">
        {f.prefecture && <input type="hidden" name="prefecture" value={f.prefecture} />}
        {!f.prefecture && f.region && <input type="hidden" name="region" value={f.region} />}
        {f.q && <input type="hidden" name="q" value={f.q} />}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t('level')}</span>
            <select name="level" defaultValue={f.level ?? ''} className={select}>
              <option value="">{t('any')}</option>
              {LEVELS.map((l) => <option key={l} value={l}>{tj(`level.${l}`)}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">{t('levelHint')}</span>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t('visa')}</span>
            <select name="visa" defaultValue={f.visa ?? ''} className={select}>
              <option value="">{t('any')}</option>
              {visas.map((v) => <option key={v.code} value={v.code}>{localize(v.name, locale)}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t('minHourly')}</span>
            <select name="min_hourly" defaultValue={f.minHourly ? String(f.minHourly) : ''} className={select}>
              <option value="">{t('any')}</option>
              {HOURLY_STEPS.map((n) => <option key={n} value={n}>{t('hourlyOption', { amount: n.toLocaleString('en-US') })}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t('employment')}</span>
            <select name="employment" defaultValue={f.employment ?? ''} className={select}>
              <option value="">{t('any')}</option>
              {EMPLOYMENT_TYPES.map((e) => <option key={e} value={e}>{tj(`employment.${e}`)}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t('features')}</legend>
          <div className="flex flex-wrap gap-2">
            {FEATURE_KEYS.map((k) => (
              <label key={k} className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full bg-slate-50 px-3 text-sm ring-1 ring-slate-200 has-[:checked]:bg-brand-light has-[:checked]:font-bold has-[:checked]:text-brand has-[:checked]:ring-brand">
                <input type="checkbox" name="features" value={k} defaultChecked={f.features?.includes(k)} className="h-4 w-4 accent-brand" />
                {tj(`feature.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">{t('sort')}</span>
            <select name="sort" defaultValue={f.sort ?? 'new'} className={select}>
              <option value="new">{t('sortNew')}</option>
              <option value="salary">{t('sortSalary')}</option>
            </select>
          </label>
          <div className="flex gap-2">
            <a href={`/${locale}/jobs${keepLocation(f)}`} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm text-navy underline">{t('reset')}</a>
            <button type="submit" className="inline-flex min-h-[44px] items-center rounded-full bg-brand px-6 text-sm font-bold text-white hover:bg-brand-dark">
              {t('apply')}
            </button>
          </div>
        </div>
      </form>
    </details>
  );
}
