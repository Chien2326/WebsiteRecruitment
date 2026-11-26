'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BarChart3, Briefcase, Building2, ChevronDown, ExternalLink, FileUser, Languages, LayoutDashboard, LogOut, MapPinned, Newspaper, ShieldAlert, Users,
  type LucideIcon,
} from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useSession } from '@/components/auth/SessionProvider';
import { can } from '@/lib/admin';
import { Spinner } from './ui';

const NAV: { href: string; key: string; icon: LucideIcon; perm: string }[] = [
  { href: '/admin', key: 'dashboard', icon: LayoutDashboard, perm: 'admin.access' },
  { href: '/admin/jobs', key: 'jobs', icon: Briefcase, perm: 'jobs.read' },
  { href: '/admin/applications', key: 'applications', icon: FileUser, perm: 'applications.read' },
  { href: '/admin/analytics', key: 'analytics', icon: BarChart3, perm: 'applications.read' },
  { href: '/admin/inquiries', key: 'inquiries', icon: Building2, perm: 'inquiries.manage' },
  { href: '/admin/news', key: 'news', icon: Newspaper, perm: 'cms.write' },
  { href: '/admin/places', key: 'places', icon: MapPinned, perm: 'places.write' },
  { href: '/admin/content', key: 'content', icon: Languages, perm: 'cms.write' },
  { href: '/admin/users', key: 'users', icon: Users, perm: 'users.manage' },
];

/**
 * Account menu (top right): who is signed in + quick actions. A real disclosure button: Escape / click outside
 * closes it, focus returns to the button.
 */
function AccountMenu({ email, role, onLogout, dark = false }: { email: string; role: string; onLogout: () => void; dark?: boolean }) {
  const t = useTranslations('admin');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const initial = (email[0] ?? '?').toUpperCase();
  return (
    <div ref={box} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('nav.account')}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-[40px] items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm ${dark ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${dark ? 'bg-white text-navy' : 'bg-navy text-white'}`} aria-hidden>
          {initial}
        </span>
        <span className="hidden min-w-0 text-left leading-tight sm:block">
          <span className={`block max-w-[14rem] truncate font-medium ${dark ? 'text-white' : 'text-slate-900'}`}>{email}</span>
          <span className={`block text-xs ${dark ? 'text-slate-300' : 'text-slate-500'}`}>{role}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${dark ? 'text-slate-300' : 'text-slate-500'}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm text-slate-700 shadow-lg">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate font-medium text-slate-900">{email}</p>
            <p className="text-xs text-slate-500">{role}</p>
          </div>
          <Link href="/" className="flex min-h-[44px] items-center gap-2 px-4 hover:bg-slate-50" onClick={() => setOpen(false)}>
            <ExternalLink className="h-4 w-4 text-slate-500" aria-hidden />{t('nav.backToSite')}
          </Link>
          <button type="button" onClick={() => { setOpen(false); onLogout(); }} className="flex min-h-[44px] w-full items-center gap-2 border-t border-slate-100 px-4 text-left text-brand hover:bg-red-50">
            <LogOut className="h-4 w-4" aria-hidden />{t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Admin chrome + client-side gate. Every API call is still authorized server-side by permission. */
export default function AdminShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const { user, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  useEffect(() => {
    if (!loading && !user) router.replace({ pathname: '/login', query: { next: `/${locale}${pathname}` } });
  }, [loading, user, router, pathname, locale]);

  if (loading || !user) return <Spinner />;
  // Per-section gate: the most specific nav entry for this URL decides (e.g. /admin/jobs/123 -> jobs.read).
  const section = NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  if (!can(user, 'admin.access') || (section && !can(user, section.perm))) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <p className="mt-3 font-bold text-navy">{t('common.forbidden')}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-navy underline">{t('nav.backToSite')}</Link>
      </div>
    );
  }

  const items = NAV.filter((n) => can(user, n.perm));
  const doLogout = () => void logout().then(() => router.push('/login'));
  const roleLabel = t(`roles.${user.role}`);
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* sticky + full viewport height: the menu stays put while the page scrolls (scrolls itself if very long) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-navy text-slate-200 lg:flex">
        <div className="px-5 py-4">
          <p className="text-lg font-bold text-white">Haken Work</p>
          <p className="text-xs text-slate-400">Admin</p>
        </div>
        <nav aria-label="admin" className="flex-1 space-y-1 px-3">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? 'page' : undefined}
              className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                isActive(n.href) ? 'bg-white/15 text-white' : 'hover:bg-white/10'
              }`}
            >
              <n.icon className="h-4 w-4" aria-hidden />
              {t(`nav.${n.key}`)}
            </Link>
          ))}
        </nav>
      </aside>

      {/* mobile / tablet: compact top bar with scrollable tabs */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-navy text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="font-bold">Haken Work Admin</span>
          <AccountMenu email={user.email} role={roleLabel} onLogout={doLogout} dark />
        </div>
        <nav aria-label="admin" className="flex gap-1 overflow-x-auto px-2 pb-2">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${isActive(n.href) ? 'bg-white/20' : 'bg-white/5'}`}>
              <n.icon className="h-3.5 w-3.5" aria-hidden />
              {t(`nav.${n.key}`)}
            </Link>
          ))}
        </nav>
      </div>

      <div className="min-w-0 flex-1">
        {/* desktop: account + quick actions in the top-right corner */}
        <header className="sticky top-0 z-30 hidden h-14 items-center justify-end border-b border-slate-200 bg-white/90 px-6 backdrop-blur lg:flex">
          <AccountMenu email={user.email} role={roleLabel} onLogout={doLogout} />
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
