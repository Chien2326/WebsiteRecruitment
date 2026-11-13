import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { NEWS_PAGE_SIZE, getNewsPage } from '@/lib/content';
import { localize } from '@/lib/job';
import { latn } from '@/lib/format';

// ?page=N must be honoured on every request (the API fetch itself stays cached + tagged 'news').
export const dynamic = 'force-dynamic';

type Props = { params: { locale: string }; searchParams: Record<string, string | string[] | undefined> };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'newsPage' });
  return { title: t('title'), description: t('lead') };
}

export default async function NewsListPage({ params: { locale }, searchParams }: Props) {
  setRequestLocale(locale);
  const raw = Number(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const page = Number.isInteger(raw) && raw >= 1 && raw <= 1000 ? raw : 1;
  const data = await getNewsPage(page);
  const t = await getTranslations('newsPage');
  const f = latn(await getFormatter());
  const pages = data ? Math.max(1, Math.ceil(data.total / NEWS_PAGE_SIZE)) : 1;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy md:text-2xl">
          <Newspaper className="h-6 w-6 text-brand" aria-hidden />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('lead')}</p>
      </header>

      {!data ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700">{t('loadError')}</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {data.items.map((n) => (
            <li key={n.slug}>
              <Link href={`/news/${n.slug}`} className="block p-4 hover:bg-slate-50 md:p-5">
                <time dateTime={n.published_at} className="text-xs font-medium text-slate-500">
                  {f.dateTime(new Date(n.published_at), { dateStyle: 'medium' })}
                </time>
                <h2 className="mt-1 font-bold text-navy">{localize(n.title, locale)}</h2>
                {n.summary && <p className="mt-1 text-sm text-slate-600">{localize(n.summary, locale)}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav aria-label={t('pagination')} className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link href={{ pathname: '/news', query: { page: page - 1 } }} className="grid h-11 w-11 place-items-center rounded-full border border-slate-300 bg-white hover:border-navy" aria-label={t('prev')}>
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
          ) : <span className="h-11 w-11" aria-hidden />}
          <span className="min-w-[4rem] text-center text-sm tabular-nums text-slate-600">{page} / {pages}</span>
          {page < pages ? (
            <Link href={{ pathname: '/news', query: { page: page + 1 } }} className="grid h-11 w-11 place-items-center rounded-full border border-slate-300 bg-white hover:border-navy" aria-label={t('next')}>
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Link>
          ) : <span className="h-11 w-11" aria-hidden />}
        </nav>
      )}
    </div>
  );
}
