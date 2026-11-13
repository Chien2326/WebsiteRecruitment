import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import RequireAuth from '@/components/auth/RequireAuth';
import AccountSettings from '@/components/account/AccountSettings';
import type { SearchParams } from '@/lib/tokens';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const code = (v: string | undefined) => (v && /^[a-z_]{1,40}$/.test(v) ? v : undefined);

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'account' });
  return { title: t('title'), robots: { index: false } };
}

export default function AccountPage({ params: { locale }, searchParams }: {
  params: { locale: string }; searchParams: SearchParams;
}) {
  setRequestLocale(locale);
  return (
    <RequireAuth>
      <AccountSettings linked={code(one(searchParams.linked))} linkError={code(one(searchParams.link_error))} />
    </RequireAuth>
  );
}
