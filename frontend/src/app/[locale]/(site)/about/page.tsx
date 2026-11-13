import { getTranslations, setRequestLocale } from 'next-intl/server';
import CmsPage from '@/components/pages/CmsPage';

type Props = { params: { locale: string } };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  return { title: t('about.title') };
}

export default async function AboutPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const t = await getTranslations('pages');
  return <CmsPage cmsKey="page.about" title={t('about.title')} locale={locale} />;
}
