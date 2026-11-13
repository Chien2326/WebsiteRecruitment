import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import AuthForm from '@/components/auth/AuthForm';

type Props = { params: { locale: string }; searchParams: Record<string, string | string[] | undefined> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: t('signupTitle'), robots: { index: false } };
}

export default function SignupPage({ params: { locale }, searchParams }: Props) {
  setRequestLocale(locale);
  return <AuthForm mode="signup" next={one(searchParams.next)} />;
}
