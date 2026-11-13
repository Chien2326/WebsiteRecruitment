import { useTranslations } from 'next-intl';
import { Home, Search } from 'lucide-react';
import Footer from '@/components/Footer';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/navigation';

/** Localized 404, rendered inside app/[locale]/layout.tsx (so it has the site chrome and the user's language). */
export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <>
      <Navbar />
      <main className="mx-auto grid w-full max-w-5xl flex-1 place-items-center px-4 py-16 text-center">
        <div>
          <p className="text-6xl font-bold text-brand">404</p>
          <h1 className="mt-3 text-xl font-bold text-navy">{t('title')}</h1>
          <p className="mt-2 text-slate-600">{t('text')}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/" className="inline-flex min-h-[48px] items-center gap-2 rounded-full border border-navy px-6 font-bold text-navy hover:bg-navy-light">
              <Home className="h-4 w-4" aria-hidden />{t('home')}
            </Link>
            <Link href="/jobs" className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-brand px-6 font-bold text-white hover:bg-brand-dark">
              <Search className="h-4 w-4" aria-hidden />{t('jobs')}
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
