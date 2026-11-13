'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRight, Lightbulb, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import type { JobListItem } from '@/lib/job';
import JobCard from '@/components/JobCard';
import { useSession } from '@/components/auth/SessionProvider';

/** おすすめ求人: matches the profile (level, visa, desired prefectures); jobs already applied to are left out. */
export default function RecommendedJobs() {
  const t = useTranslations('mypage');
  const { user } = useSession();
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);

  useEffect(() => {
    api<JobListItem[]>('/me/recommended-jobs?limit=4').then(setJobs).catch(() => setJobs([]));
  }, []);

  return (
    <section aria-labelledby="rec-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rec-title" className="flex items-center gap-2 text-lg font-bold text-navy">
          <Lightbulb className="h-5 w-5 text-brand" aria-hidden />
          {t('recommendedTitle')}
        </h2>
        <Link href="/jobs" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-navy hover:underline">
          {t('recommendedMore')}
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <p className="text-sm text-slate-600">
        {user?.profile_complete ? t('recommendedText') : (
          <>
            {t('recommendedHint')}{' '}
            <Link href="/mypage/profile" className="font-bold text-navy underline">{t('recommendedHintLink')}</Link>
          </>
        )}
      </p>
      {!jobs ? (
        <div className="grid min-h-[8rem] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden /></div>
      ) : jobs.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-600">{t('recommendedEmpty')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {jobs.map((j) => <li key={j.id}><JobCard job={j} /></li>)}
        </ul>
      )}
    </section>
  );
}
