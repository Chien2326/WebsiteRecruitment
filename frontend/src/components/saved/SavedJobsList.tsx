'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, Heart, Loader2, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import type { JobListItem } from '@/lib/job';
import JobCard from '@/components/JobCard';
import { useSavedJobs } from './SavedJobsProvider';

export default function SavedJobsList() {
  const t = useTranslations('mypage');
  const { ids } = useSavedJobs();
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);

  useEffect(() => {
    api<JobListItem[]>('/me/saved-jobs').then(setJobs).catch(() => setJobs([]));
  }, []);

  // un-hearting a card removes it from this page at once
  const shown = jobs?.filter((j) => !ids || ids.has(j.id)) ?? null;

  return (
    <div className="space-y-5">
      <Link href="/mypage" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-navy hover:underline">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t('backToMypage')}
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-bold text-navy md:text-2xl">
        <Heart className="h-6 w-6 text-brand" aria-hidden />
        {t('savedTitle')}
      </h1>
      {!shown ? (
        <div className="grid min-h-[30vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden /></div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-600">{t('savedEmpty')}</p>
          <Link href="/jobs" className="mt-4 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-brand px-6 font-bold text-white hover:bg-brand-dark">
            <Search className="h-4 w-4" aria-hidden />
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {shown.map((j) => <li key={j.id}><JobCard job={j} /></li>)}
        </ul>
      )}
    </div>
  );
}
