import { getTranslations, setRequestLocale } from 'next-intl/server';
import CmsPage from '@/components/pages/CmsPage';

type Props = { params: { locale: string } };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  return { title: t('privacy.title') };
}

export default async function PrivacyPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const t = await getTranslations('pages');
  return <CmsPage cmsKey="page.privacy" title={t('privacy.title')} locale={locale} />;
}
