import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import RichText from '@/components/RichText';
import { getNewsPost } from '@/lib/content';
import { localize } from '@/lib/job';
import { latn } from '@/lib/format';

type Props = { params: { locale: string; slug: string } };

/** Which language the text is actually in (the post may not be translated into the visitor's language). */
const shownLang = (v: Record<string, string>, locale: string) => (v[locale] ? locale : v.ja ? 'ja' : Object.keys(v)[0]);

export async function generateMetadata({ params: { locale, slug } }: Props) {
  const post = await getNewsPost(slug);
  if (!post) return {};
  return { title: localize(post.title, locale), description: post.summary ? localize(post.summary, locale) : undefined };
}

export default async function NewsDetailPage({ params: { locale, slug } }: Props) {
  setRequestLocale(locale);
  const post = await getNewsPost(slug);
  if (!post) notFound();
  const t = await getTranslations('newsPage');
  const f = latn(await getFormatter());
  const untranslated = !post.body[locale];

  return (
    <article className="mx-auto max-w-3xl">
      <Link href="/news" className="inline-flex min-h-[44px] items-center text-sm text-navy hover:underline">
        ← {t('backToList')}
      </Link>
      <header className="mt-2 border-b border-slate-200 pb-4">
        <time dateTime={post.published_at} className="text-sm text-slate-500">
          {f.dateTime(new Date(post.published_at), { dateStyle: 'long' })}
        </time>
        <h1 lang={shownLang(post.title, locale)} className="mt-1 text-xl font-bold text-navy md:text-2xl">
          {localize(post.title, locale)}
        </h1>
      </header>
      {untranslated && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('notTranslated')}</p>
      )}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <RichText text={localize(post.body, locale)} lang={shownLang(post.body, locale)} />
      </div>
    </article>
  );
}
