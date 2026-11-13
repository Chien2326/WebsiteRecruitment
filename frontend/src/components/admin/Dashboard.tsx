'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Briefcase, Building2, CheckCircle2, Clock, FileUser, Inbox, Languages, MapPinned, Newspaper, PencilLine } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useSession } from '@/components/auth/SessionProvider';
import { api } from '@/lib/api';
import { can } from '@/lib/admin';
import { Spinner } from './ui';

export default function Dashboard() {
  const t = useTranslations('admin');
  const { user } = useSession();
  const [stats, setStats] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    api<Record<string, number>>('/admin/stats').then(setStats).catch(() => setStats({}));
  }, []);
  if (!stats) return <Spinner />;

  const cards = [
    { key: 'jobs_pending', label: t('dashboard.pendingJobs'), icon: Clock, href: '/admin/jobs?status=pending', cls: 'text-amber-600', perm: 'jobs.read' },
    { key: 'jobs_published', label: t('dashboard.publishedJobs'), icon: CheckCircle2, href: '/admin/jobs?status=published', cls: 'text-emerald-600', perm: 'jobs.read' },
    { key: 'jobs_draft', label: t('dashboard.draftJobs'), icon: PencilLine, href: '/admin/jobs?status=draft', cls: 'text-slate-600', perm: 'jobs.read' },
    { key: 'applications_new', label: t('dashboard.newApplications'), icon: Inbox, href: '/admin/applications?status=applied', cls: 'text-brand', perm: 'applications.read' },
    { key: 'applications_7d', label: t('dashboard.applications7d'), icon: FileUser, href: '/admin/applications', cls: 'text-navy', perm: 'applications.read' },
    { key: 'inquiries_new', label: t('dashboard.newInquiries'), icon: Building2, href: '/admin/inquiries', cls: 'text-sky-700', perm: 'inquiries.manage' },
  ].filter((c) => can(user, c.perm));

  const links = [
    { href: '/admin/jobs/new', label: t('jobs.new'), icon: Briefcase, perm: 'jobs.write' },
    { href: '/admin/places', label: t('nav.places'), icon: MapPinned, perm: 'places.write' },
    { href: '/admin/news', label: t('nav.news'), icon: Newspaper, perm: 'cms.write' },
    { href: '/admin/content', label: t('nav.content'), icon: Languages, perm: 'cms.write' },
  ].filter((l) => can(user, l.perm));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy">{t('dashboard.title')}</h1>
        <p className="text-sm text-slate-600">{t('dashboard.welcome', { email: user?.email ?? '' })}</p>
      </div>
      {cards.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {cards.map((c) => (
            <Link key={c.key} href={c.href} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-navy">
              <c.icon className={`h-5 w-5 ${c.cls}`} aria-hidden />
              <p className={`mt-2 text-3xl font-bold tabular-nums ${c.cls}`}>{stats[c.key] ?? 0}</p>
              <p className="text-xs text-slate-600">{c.label}</p>
            </Link>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-navy">{t('dashboard.quickLinks')}</h2>
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-navy hover:border-navy">
                <l.icon className="h-4 w-4" aria-hidden />
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
