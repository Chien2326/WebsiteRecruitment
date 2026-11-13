import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MapPinned } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { REGION_CODES, isPrefectureActive, placeName, prefecturesOf } from '@/lib/japan';
import { getPlaces, getPrefectureCounts } from '@/lib/job';

type Props = { params: { locale: string } };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'prefecturesPage' });
  return { title: t('title') };
}

/** All 47 prefectures by region, with live job counts; hidden ones (admin "places") are left out. */
export default async function PrefecturesPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const [t, tr, counts, places] = await Promise.all([
    getTranslations('prefecturesPage'), getTranslations('regions'), getPrefectureCounts(), getPlaces(),
  ]);
  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy md:text-2xl">
          <MapPinned className="h-6 w-6 text-brand" aria-hidden />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('lead')}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {REGION_CODES.map((r) => {
          const prefs = prefecturesOf(r).filter((p) => isPrefectureActive(p, places));
          if (prefs.length === 0) return null;
          return (
            <section key={r} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`r-${r}`}>
              <h2 id={`r-${r}`} className="font-bold text-navy">
                <Link href={{ pathname: '/jobs', query: { region: r } }} className="hover:text-brand">{tr(r)}</Link>
              </h2>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {prefs.map((p) => {
                  const n = counts?.[p.id] ?? 0;
                  return (
                    <li key={p.id}>
                      <Link href={{ pathname: '/jobs', query: { prefecture: p.id } }}
                        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-sm ring-1 ${
                          n > 0 ? 'bg-brand-light font-bold text-navy ring-brand/30 hover:ring-brand' : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-400'
                        }`}>
                        {placeName(p, locale, places)}
                        <span className={`tabular-nums ${n > 0 ? 'text-brand' : 'text-slate-400'}`}>{n}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
