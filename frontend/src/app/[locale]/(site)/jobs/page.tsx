import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import JobCard from '@/components/JobCard';
import JobFilterForm from '@/components/jobs/JobFilterForm';
import RecentlyViewed from '@/components/jobs/RecentlyViewed';
import JapanMap from '@/components/map/JapanMap';
import QuickSearch from '@/components/map/QuickSearch';
import { Link } from '@/i18n/navigation';
import { PREFECTURE_BY_ID, isRegionCode, prefectureName, type RegionCode } from '@/lib/japan';
import {
  EMPLOYMENT_TYPES, FEATURE_KEYS, HOURLY_STEPS, JOBS_PAGE_SIZE, LEVELS, getPlaces, getPrefectureCounts, getVisaTypes,
  jobSearchQuery, searchJobsPage, type JobSearch,
} from '@/lib/job';

// Results depend on the query string: always render per request.
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const oneOf = <T extends string>(list: readonly T[], v: string | undefined): T | undefined =>
  list.includes(v as T) ? (v as T) : undefined;

/** Untrusted URL input -> validated filters (anything invalid is simply ignored). */
function parseFilters(sp: SearchParams): JobSearch & { region?: RegionCode } {
  const f: JobSearch & { region?: RegionCode } = {};
  const p = Number(first(sp.prefecture));
  if (Number.isInteger(p) && p >= 1 && p <= 47) f.prefecture = p;
  const r = first(sp.region);
  if (!f.prefecture && isRegionCode(r)) f.region = r;
  const q = first(sp.q)?.trim().slice(0, 100);
  if (q) f.q = q;
  f.level = oneOf(LEVELS, first(sp.level));
  const visa = first(sp.visa);
  if (visa && /^[a-z0-9_]{2,50}$/.test(visa)) f.visa = visa;
  const h = Number(first(sp.min_hourly));
  if ((HOURLY_STEPS as readonly number[]).includes(h)) f.minHourly = h;
  f.employment = oneOf(EMPLOYMENT_TYPES, first(sp.employment));
  f.features = all(sp.features).filter((x) => (FEATURE_KEYS as readonly string[]).includes(x)).slice(0, 4);
  f.sort = first(sp.sort) === 'salary' ? 'salary' : 'new';
  const pg = Number(first(sp.page));
  f.page = Number.isInteger(pg) && pg >= 1 && pg <= 1000 ? pg : 1;
  return f;
}

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'jobsPage' });
  return { title: t('title') };
}

export default async function JobsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: SearchParams;
}) {
  setRequestLocale(locale);
  const f = parseFilters(searchParams);
  const [counts, result, places, visas] = await Promise.all([getPrefectureCounts(), searchJobsPage(f), getPlaces(), getVisaTypes()]);
  const t = await getTranslations('jobsPage');
  const tm = await getTranslations('map');
  const tr = await getTranslations('regions');

  const pref = f.prefecture ? PREFECTURE_BY_ID.get(f.prefecture) : undefined;
  const place = pref ? prefectureName(pref, locale) : f.region ? tr(f.region) : tm('allJapan');
  const filtered = Object.keys(jobSearchQuery({ ...f, page: 1 })).length > 0;
  const pages = Math.max(1, Math.ceil(result.total / JOBS_PAGE_SIZE));
  const pageHref = (page: number) => ({ pathname: '/jobs' as const, query: jobSearchQuery({ ...f, page }) });

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-navy md:text-2xl">{t('title')}</h1>
      <QuickSearch key={`search:${f.prefecture ?? ''}|${f.q ?? ''}`} counts={counts} defaultPrefecture={f.prefecture} defaultQ={f.q} places={places} />
      {/* key: re-mount (and re-zoom) when the location filter changes. The "search:" / "map:" prefixes keep the two
          sibling keys different - identical keys made React keep the old search box, stacking a new one per click. */}
      <JapanMap
        key={`map:${f.prefecture ?? ''}|${f.region ?? ''}`}
        counts={counts}
        mode="filter"
        selectedPrefectureId={f.prefecture}
        selectedRegion={f.region}
        keyword={f.q}
        places={places}
      />
      <JobFilterForm f={f} locale={locale} visas={visas} />
      <RecentlyViewed />

      <section aria-labelledby="results-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="results-heading" className="flex items-center gap-1.5 text-lg font-bold text-navy">
            <MapPin className="h-5 w-5 text-brand" aria-hidden />
            {place}
            {f.q && <span className="font-normal text-slate-600">・「{f.q}」</span>}
          </h2>
          <p className="text-sm text-slate-600" aria-live="polite">
            {t('resultCount', { count: result.total })}
            {result.total > 0 && pages > 1 && (
              <span className="ml-2">{t('showing', { from: (result.page - 1) * JOBS_PAGE_SIZE + 1, to: (result.page - 1) * JOBS_PAGE_SIZE + result.items.length })}</span>
            )}
          </p>
        </div>
        {filtered && (
          <Link href="/jobs" scroll={false} className="mt-1 inline-flex min-h-[44px] items-center text-sm text-navy underline">
            {t('clearFilters')}
          </Link>
        )}
        {result.items.length > 0 ? (
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {result.items.map((j) => (
              <li key={j.id}>
                <JobCard job={j} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
            {t('noResults')}
          </p>
        )}

        {pages > 1 && (
          <nav aria-label={t('pagination')} className="mt-5 flex items-center justify-center gap-2">
            {result.page > 1 ? (
              <Link href={pageHref(result.page - 1)} className="grid h-11 w-11 place-items-center rounded-full border border-slate-300 bg-white hover:border-navy" aria-label={t('prev')}>
                <ChevronLeft className="h-5 w-5" aria-hidden />
              </Link>
            ) : <span className="h-11 w-11" aria-hidden />}
            <span className="min-w-[4rem] text-center text-sm tabular-nums text-slate-600">{result.page} / {pages}</span>
            {result.page < pages ? (
              <Link href={pageHref(result.page + 1)} className="grid h-11 w-11 place-items-center rounded-full border border-slate-300 bg-white hover:border-navy" aria-label={t('next')}>
                <ChevronRight className="h-5 w-5" aria-hidden />
              </Link>
            ) : <span className="h-11 w-11" aria-hidden />}
          </nav>
        )}
      </section>
    </div>
  );
}
