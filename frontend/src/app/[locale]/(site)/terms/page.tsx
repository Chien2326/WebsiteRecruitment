import { getTranslations, setRequestLocale } from 'next-intl/server';
import CmsPage from '@/components/pages/CmsPage';

type Props = { params: { locale: string } };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'pages' });
  return { title: t('terms.title') };
}

export default async function TermsPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const t = await getTranslations('pages');
  return <CmsPage cmsKey="page.terms" title={t('terms.title')} locale={locale} />;
}
