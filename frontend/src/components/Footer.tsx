import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export default async function Footer() {
  const t = await getTranslations('footer');
  const brand = (await getTranslations('common'))('siteName');

  const columns = [
    {
      title: t('jobSeekers'),
      items: [
        { href: '/jobs', label: t('searchJobs') },
        { href: '/jobs/prefectures', label: t('byPrefecture') },
        { href: '/visa', label: t('visaInfo') },
      ],
    },
    {
      title: t('company'),
      items: [
        { href: '/about', label: t('about') },
        { href: '/news', label: t('news') },
        { href: '/employers', label: t('forEmployers') },
      ],
    },
    {
      title: t('support'),
      items: [
        { href: '/faq', label: t('faq') },
        { href: '/contact', label: t('contact') },
        { href: '/privacy', label: t('privacy') },
        { href: '/terms', label: t('terms') },
      ],
    },
  ];

  return (
    <footer className="mt-12 border-t border-slate-200 bg-navy text-slate-100">
      <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 md:grid-cols-4">
        <div>
          <p className="text-xl font-bold text-white">{brand}</p>
          <p className="mt-2 text-sm text-slate-300">{t('tagline')}</p>
        </div>
        {columns.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="font-bold text-white">{c.title}</p>
            <ul className="mt-2 space-y-1">
              {c.items.map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="inline-block min-h-[32px] py-1 text-sm text-slate-300 hover:text-white">
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <p className="border-t border-white/10 py-4 text-center text-xs text-slate-300">
        {t('copyright', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
