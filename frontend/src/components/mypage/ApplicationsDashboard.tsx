'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Briefcase, ChevronRight, FileText, Heart, MapPin, Search, Settings, Sparkles, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError, api, type MyApplication } from '@/lib/api';
import VerifyBanner from '@/components/account/VerifyBanner';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { localize, salaryText } from '@/lib/job';
import { useSession } from '@/components/auth/SessionProvider';
import { useSavedJobs } from '@/components/saved/SavedJobsProvider';
import RecommendedJobs from './RecommendedJobs';
import StatusBadge, { StatusStepper } from './StatusBadge';
import { latn } from '@/lib/format';

type Translate = (key: string, values: Record<string, string>) => string;

export default function ApplicationsDashboard() {
  const t = useTranslations('mypage');
  const ta = useTranslations('account');
  const te = useTranslations('errors');
  const tj = useTranslations('jobDetail');
  const f = latn(useFormatter());
  const locale = useLocale();
  const { user } = useSession();
  const { ids: savedIds } = useSavedJobs();
  const [apps, setApps] = useState<MyApplication[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<MyApplication[]>('/applications/my-applications')
      .then(setApps)
      .catch((e) => setErr(e instanceof ApiError ? e.code : 'generic'));
  }, []);

  const count = (pred: (a: MyApplication) => boolean) => apps?.filter(pred).length ?? 0;
  const stats = [
    { label: t('total'), value: apps?.length ?? 0, cls: 'text-navy' },
    { label: t('inProgress'), value: count((a) => a.status === 'applied' || a.status === 'reviewing'), cls: 'text-amber-600' },
    { label: t('interview'), value: count((a) => a.status === 'interview'), cls: 'text-violet-600' },
    { label: t('accepted'), value: count((a) => a.status === 'accepted'), cls: 'text-emerald-600' },
  ];

  return (
    <div className="space-y-5">
      {/* greeting */}
      <section className="rounded-3xl bg-gradient-to-br from-brand-light via-white to-navy-light p-5">
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <Sparkles className="h-4 w-4 text-brand" aria-hidden />
          {t('title')}
        </p>
        <h1 className="mt-1 text-xl font-bold text-navy md:text-2xl">
          {user?.display_name ? t('hello', { name: user.display_name }) : t('helloAnon')}
        </h1>
        <dl className="mt-4 grid grid-cols-4 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl bg-white/80 p-2 text-center shadow-sm">
              <dt className="truncate text-[11px] text-slate-500">{s.label}</dt>
              <dd className={`text-2xl font-bold tabular-nums ${s.cls}`}>{apps ? s.value : '–'}</dd>
            </div>
          ))}
        </dl>
      </section>

      {user && !user.email_verified && <VerifyBanner />}

      {/* account settings card */}
      <Link
        href="/mypage/account"
        className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-light text-brand">
          <Settings className="h-6 w-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-navy">{ta('settingsCardTitle')}</span>
          <span className="block text-sm text-slate-600">{ta('settingsCardText')}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      </Link>

      {/* profile card */}
      <Link
        href="/mypage/profile"
        className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-navy-light text-navy">
          <UserRound className="h-6 w-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-bold text-navy">
            {t('profileCardTitle')}
            <FileText className="h-4 w-4 text-slate-400" aria-hidden />
          </span>
          <span className="block text-sm text-slate-600">{t('profileCardText')}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      </Link>

      {/* saved jobs card */}
      <Link
        href="/mypage/saved"
        className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-light text-brand">
          <Heart className="h-6 w-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-navy">
            {t('savedCardTitle')}
            {savedIds && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-white tabular-nums">{savedIds.size}</span>}
          </span>
          <span className="block text-sm text-slate-600">{t('savedCardText')}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
      </Link>

      <RecommendedJobs />

      {/* applications */}
      <section aria-labelledby="apps-title">
        <h2 id="apps-title" className="flex items-center gap-2 text-lg font-bold text-navy">
          <Briefcase className="h-5 w-5 text-brand" aria-hidden />
          {t('applications')}
        </h2>

        {err && (
          <p role="alert" className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {te.has(err) ? te(err) : te('generic')}
          </p>
        )}

        {!apps && !err && (
          <ul className="mt-3 space-y-3" aria-hidden>
            {[0, 1].map((i) => (
              <li key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </ul>
        )}

        {apps?.length === 0 && (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Search className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
            <p className="mt-2 text-slate-600">{t('empty')}</p>
            <Link
              href="/jobs"
              className="mt-4 inline-flex min-h-[48px] items-center rounded-full bg-brand px-6 font-bold text-white hover:bg-brand-dark"
            >
              {t('emptyCta')}
            </Link>
          </div>
        )}

        {apps && apps.length > 0 && (
          <ul className="mt-3 space-y-3">
            {apps.map((a) => {
              const pref = PREFECTURE_BY_ID.get(a.job.prefecture.id);
              return (
                <li key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <StatusBadge status={a.status} />
                    <span className="text-xs text-slate-500">
                      {t('appliedOn', { date: f.dateTime(new Date(a.created_at), { dateStyle: 'medium' }) })}
                    </span>
                  </div>
                  <Link href={`/jobs/${a.job.job_code}`} className="mt-2 block font-bold text-navy hover:underline">
                    {localize(a.job.title, locale)}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-4 w-4 text-brand" aria-hidden />
                      {pref ? prefectureName(pref, locale) : ''}
                    </span>
                    <span className="font-medium text-brand">
                      {salaryText(tj as unknown as Translate, (n) => f.number(n), a.job)}
                    </span>
                  </p>
                  <StatusStepper status={a.status} />
                  {a.status_changed_at !== a.created_at && (
                    <p className="mt-2 text-right text-[11px] text-slate-400">
                      {t('updatedOn', { date: f.dateTime(new Date(a.status_changed_at), { dateStyle: 'medium' }) })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
