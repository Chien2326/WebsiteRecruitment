'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Menu, UserRound, X } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSession } from './auth/SessionProvider';
import LanguageSwitcher from './LanguageSwitcher';

export default function Navbar() {
  const t = useTranslations('nav');
  const ta = useTranslations('auth');
  const brand = useTranslations('common')('siteName');
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/', label: t('home') },
    { href: '/jobs', label: t('jobs') },
    { href: '/news', label: t('news') },
    { href: '/employers', label: t('forEmployers') },
  ] as const;

  async function onLogout() {
    setOpen(false);
    await logout();
    router.push('/');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
        <Link href="/" className="text-xl font-bold text-brand">
          {brand}
        </Link>

        {/* Desktop links. flex-wrap + min-h (not fixed h) so long Myanmar/Nepali labels can wrap. */}
        <nav aria-label={t('main')} className="hidden flex-wrap items-center gap-x-5 gap-y-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="py-2 text-sm font-medium text-slate-700 hover:text-brand">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          {/* Reserve space while the session loads to avoid a layout jump */}
          {loading ? (
            <span className="hidden h-11 w-40 md:block" aria-hidden />
          ) : user ? (
            <>
              <Link
                href="/mypage"
                className="hidden min-h-[44px] items-center gap-1.5 rounded-full bg-navy-light px-4 text-sm font-bold text-navy hover:bg-navy hover:text-white md:inline-flex"
              >
                <UserRound className="h-4 w-4" aria-hidden />
                {ta('myPage')}
              </Link>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="hidden h-11 w-11 place-items-center rounded-full text-slate-500 hover:bg-slate-100 md:grid"
                aria-label={ta('logout')}
                title={ta('logout')}
              >
                <LogOut className="h-5 w-5" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden min-h-[44px] items-center rounded-full px-3 text-sm font-medium text-navy hover:bg-navy-light md:inline-flex">
                {t('login')}
              </Link>
              <Link href="/signup" className="hidden min-h-[44px] items-center rounded-full bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark md:inline-flex">
                {t('signup')}
              </Link>
            </>
          )}
          <button
            type="button"
            className="grid h-11 w-11 place-items-center rounded-full hover:bg-slate-100 md:hidden"
            aria-expanded={open}
            aria-label={open ? t('closeMenu') : t('openMenu')}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
          </button>
        </div>
      </div>

      {open && (
        <nav aria-label={t('main')} className="border-t border-slate-100 bg-white px-4 pb-4 md:hidden">
          <ul className="divide-y divide-slate-100">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block min-h-[48px] py-3 text-base font-medium">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {user ? (
              <>
                <Link href="/mypage" onClick={() => setOpen(false)} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-navy font-bold text-white">
                  <UserRound className="h-4 w-4" aria-hidden />
                  {ta('myPage')}
                </Link>
                <button type="button" onClick={() => void onLogout()} className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-slate-300 text-slate-700">
                  <LogOut className="h-4 w-4" aria-hidden />
                  {ta('logout')}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="grid min-h-[48px] place-items-center rounded-full border border-navy text-navy">
                  {t('login')}
                </Link>
                <Link href="/signup" onClick={() => setOpen(false)} className="grid min-h-[48px] place-items-center rounded-full bg-brand font-bold text-white">
                  {t('signup')}
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
