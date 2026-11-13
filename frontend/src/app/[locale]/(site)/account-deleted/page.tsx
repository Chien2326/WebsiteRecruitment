import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('deleteSection'), robots: { index: false } };
}

export default async function AccountDeletedPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'account' });
  const tn = await getTranslations({ locale, namespace: 'mypage' });
  return (
    <div className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
      <p className="mt-4 text-slate-700">{t('deletedDone')}</p>
      <Link href="/jobs" className="mt-6 inline-flex min-h-[48px] items-center rounded-full bg-brand px-6 font-bold text-white">
        {tn('emptyCta')}
      </Link>
    </div>
  );
}
