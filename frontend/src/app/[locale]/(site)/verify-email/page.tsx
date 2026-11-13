import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import VerifyEmail from '@/components/account/VerifyEmail';
import { tokenParam, type SearchParams } from '@/lib/tokens';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('verifyTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

export default function VerifyEmailPage({ params: { locale }, searchParams }: {
  params: { locale: string }; searchParams: SearchParams;
}) {
  setRequestLocale(locale);
  return <VerifyEmail token={tokenParam(searchParams)} />;
}
