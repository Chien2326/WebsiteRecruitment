import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ResetPasswordForm from '@/components/account/ResetPasswordForm';
import { tokenParam, type SearchParams } from '@/lib/tokens';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'account' });
  // no-referrer: the one-time token in this URL must never leak to another site via the Referer header
  return { title: t('resetTitle'), robots: { index: false }, referrer: 'no-referrer' };
}

export default function ResetPasswordPage({ params: { locale }, searchParams }: {
  params: { locale: string }; searchParams: SearchParams;
}) {
  setRequestLocale(locale);
  return <ResetPasswordForm token={tokenParam(searchParams)} />;
}
