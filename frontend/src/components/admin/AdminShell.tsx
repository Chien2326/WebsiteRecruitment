'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  BarChart3, Briefcase, Building2, ExternalLink, FileUser, Languages, LayoutDashboard, LogOut, MapPinned, Newspaper, ShieldAlert, Users,
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
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col bg-navy text-slate-200 lg:flex">
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
        <div className="border-t border-white/10 p-4 text-xs">
          <p className="truncate text-white">{user.email}</p>
          <p className="text-slate-400">{t(`roles.${user.role}`)}</p>
          <div className="mt-3 flex gap-3">
            <Link href="/" className="inline-flex items-center gap-1 hover:text-white"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{t('nav.backToSite')}</Link>
            <button type="button" onClick={() => void logout().then(() => router.push('/login'))} className="inline-flex items-center gap-1 hover:text-white">
              <LogOut className="h-3.5 w-3.5" aria-hidden />{t('nav.logout')}
            </button>
          </div>
        </div>
      </aside>

      {/* mobile / tablet: compact top bar with scrollable tabs */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-navy text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="font-bold">Haken Work Admin</span>
          <span className="truncate pl-3 text-xs text-slate-300">{t(`roles.${user.role}`)}</span>
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

      <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
    </div>
  );
}
