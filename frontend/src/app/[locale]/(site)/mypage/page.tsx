import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import RequireAuth from '@/components/auth/RequireAuth';
import ApplicationsDashboard from '@/components/mypage/ApplicationsDashboard';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'mypage' });
  return { title: t('title'), robots: { index: false } };
}

export default function MyPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <RequireAuth>
      <ApplicationsDashboard />
    </RequireAuth>
  );
}
