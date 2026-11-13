import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import RequireAuth from '@/components/auth/RequireAuth';
import SavedJobsList from '@/components/saved/SavedJobsList';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'mypage' });
  return { title: t('savedTitle'), robots: { index: false } };
}

export default function SavedJobsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <RequireAuth>
      <SavedJobsList />
    </RequireAuth>
  );
}
