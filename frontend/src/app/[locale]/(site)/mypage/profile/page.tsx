import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import RequireAuth from '@/components/auth/RequireAuth';
import ProfileForm from '@/components/mypage/ProfileForm';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'profile' });
  return { title: t('title'), robots: { index: false } };
}

export default function ProfilePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  return (
    <RequireAuth>
      <ProfileForm />
    </RequireAuth>
  );
}
