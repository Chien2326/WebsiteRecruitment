import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import AuthForm from '@/components/auth/AuthForm';

type Props = { params: { locale: string }; searchParams: Record<string, string | string[] | undefined> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('loginTitle'), robots: { index: false } };
}

export default function LoginPage({ params: { locale }, searchParams }: Props) {
  setRequestLocale(locale);
  const error = one(searchParams.error);
  return <AuthForm mode="login" next={one(searchParams.next)} error={error && /^[a-z_]{1,40}$/.test(error) ? error : undefined} />;
}
