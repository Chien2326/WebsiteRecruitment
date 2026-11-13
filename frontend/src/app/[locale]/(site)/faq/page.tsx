import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HelpCircle } from 'lucide-react';
import { Link } from '@/i18n/navigation';

type Props = { params: { locale: string } };

const GROUPS = [
  { key: 'start', items: ['free', 'noJapanese', 'abroad'] },
  { key: 'apply', items: ['how', 'cv', 'status', 'cancel'] },
  { key: 'work', items: ['visa', 'dormitory', 'pay'] },
  { key: 'account', items: ['password', 'delete'] },
] as const;

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'faqPage' });
  return { title: t('title') };
}

export default async function FaqPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const t = await getTranslations('faqPage');
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy md:text-2xl">
          <HelpCircle className="h-6 w-6 text-brand" aria-hidden />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('lead')}</p>
      </header>
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`faq-${g.key}`}>
          <h2 id={`faq-${g.key}`} className="mb-2 font-bold text-navy">{t(`groups.${g.key}`)}</h2>
          <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {g.items.map((k) => (
              <details key={k} className="group p-4">
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 font-bold text-navy">
                  <span><span className="mr-2 text-brand">Q.</span>{t(`items.${k}.q`)}</span>
                  <span className="text-slate-400 transition group-open:rotate-45" aria-hidden>＋</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">
                  <span className="mr-2 font-bold text-navy">A.</span>
                  {t(`items.${k}.a`)}
                </p>
              </details>
            ))}
          </div>
        </section>
      ))}
      <p className="rounded-2xl bg-brand-light p-4 text-sm text-slate-700">
        {t('more')}{' '}
        <Link href="/contact" className="font-bold text-navy underline">{t('contactLink')}</Link>
      </p>
    </div>
  );
}
