import { getTranslations } from 'next-intl/server';
import RichText from '@/components/RichText';
import { getCmsBlock, localize } from '@/lib/job';

/** A page whose body is an admin-editable CMS block (Admin -> コンテンツ・翻訳 -> CMS, key e.g. "page.privacy"). */
export default async function CmsPage({ cmsKey, title, locale }: { cmsKey: string; title: string; locale: string }) {
  const [content, t] = await Promise.all([getCmsBlock(cmsKey), getTranslations('pages')]);
  const lang = content ? (content[locale] ? locale : 'ja') : locale;
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold text-navy md:text-2xl">{title}</h1>
      {content && !content[locale] && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t('notTranslated')}</p>
      )}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-8">
        {content ? <RichText text={localize(content, locale)} lang={lang} /> : <p className="text-slate-600">{t('preparing')}</p>}
      </div>
    </article>
  );
}
