import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronRight, Newspaper } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getNewsPage } from '@/lib/content';
import JapanMap from '@/components/map/JapanMap';
import QuickSearch from '@/components/map/QuickSearch';
import { getCmsBlock, getPlaces, getPrefectureCounts, localize } from '@/lib/job';
import { latn } from '@/lib/format';

// Static page, refreshed at most once a minute (counts come from a 60s-cached API call).
export const revalidate = 60;

export default async function HomePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations('meta');
  const [counts, places, notice, news] = await Promise.all([
    getPrefectureCounts(), getPlaces(), getCmsBlock('home.notice'), getNewsPage(1, 3),
  ]);
  const tn = await getTranslations('newsPage');
  const f = latn(await getFormatter());

  return (
    <div className="space-y-6">
      {notice && localize(notice, locale) && (
        <p role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {localize(notice, locale)}
        </p>
      )}
      <section className="rounded-3xl bg-gradient-to-br from-brand-light via-white to-navy-light px-4 py-8 text-center md:py-12">
        <h1 className="text-2xl font-bold text-navy md:text-3xl">{t('title')}</h1>
        <p className="mt-2 text-slate-600">{t('description')}</p>
        <div className="mx-auto mt-5 max-w-3xl text-left">
          <QuickSearch counts={counts} places={places} />
        </div>
      </section>
      <JapanMap counts={counts} mode="navigate" places={places} />
      {news && news.items.length > 0 && (
        <section aria-labelledby="home-news" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 id="home-news" className="flex items-center gap-2 text-lg font-bold text-navy">
              <Newspaper className="h-5 w-5 text-brand" aria-hidden />
              {tn('title')}
            </h2>
            <Link href="/news" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-navy hover:underline">
              {tn('seeAll')}<ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <ul className="mt-1 divide-y divide-slate-100">
            {news.items.map((n) => (
              <li key={n.slug}>
                <Link href={`/news/${n.slug}`} className="flex flex-col gap-0.5 py-3 hover:text-brand sm:flex-row sm:items-baseline sm:gap-4">
                  <time dateTime={n.published_at} className="shrink-0 text-xs text-slate-500 sm:w-28">
                    {f.dateTime(new Date(n.published_at), { dateStyle: 'medium' })}
                  </time>
                  <span className="font-medium text-navy">{localize(n.title, locale)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
