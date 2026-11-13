import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import '../globals.css';
import { SessionProvider } from '@/components/auth/SessionProvider';
import { SavedJobsProvider } from '@/components/saved/SavedJobsProvider';
import { LOCALES, isLocale } from '@/i18n/routing';

// Self-hosted fonts (@fontsource): no Google request at build/run time. Each family is split into
// unicode-range chunks, so the browser downloads only the scripts actually rendered.
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import '@fontsource/noto-sans-jp/700.css';
import '@fontsource/noto-sans-myanmar/400.css';
import '@fontsource/noto-sans-myanmar/700.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/700.css';
import '@fontsource/noto-sans-bengali/400.css';
import '@fontsource/noto-sans-bengali/700.css';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'meta' });
  return {
    title: t('title'),
    description: t('description'),
    // hreflang for SEO across all six languages
    alternates: {
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
  };
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider messages={messages}>
          {/* Public pages get Navbar/Footer from (site)/layout; /admin has its own shell. */}
          <SessionProvider>
            <SavedJobsProvider>{children}</SavedJobsProvider>
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
