import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import ForgotPasswordForm from '@/components/account/ForgotPasswordForm';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('forgotTitle'), robots: { index: false } };
}

export default function ForgotPasswordPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return <ForgotPasswordForm />;
}
