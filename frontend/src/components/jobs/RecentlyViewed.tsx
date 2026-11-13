'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { History, X } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { localize, salaryText, type JobListItem } from '@/lib/job';
import { latn } from '@/lib/format';

/**
 * Recently viewed jobs, kept only in this browser (localStorage): no account needed, nothing sent to the server.
 * Only public card fields are stored. Storage may be blocked (private mode), so every access is guarded.
 */
const KEY = 'hw_recent_jobs';
const MAX = 10;
type Translate = (key: string, values: Record<string, string>) => string;

function read(): JobListItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v)
      ? v.filter((x) => x && typeof x.id === 'string' && typeof x.job_code === 'string' && x.title && x.prefecture)
      : [];
  } catch {
    return [];
  }
}

function write(list: JobListItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage full or blocked: the feature just stays empty */
  }
}

/** Put on the job detail page: records the visit. Renders nothing. */
export function TrackJobView({ job }: { job: JobListItem }) {
  useEffect(() => {
    const card: JobListItem = {
      id: job.id, job_code: job.job_code, title: job.title, employment_type: job.employment_type,
      salary_type: job.salary_type, salary_min: job.salary_min, salary_max: job.salary_max,
      prefecture: job.prefecture, japanese_level_required: job.japanese_level_required,
      features: job.features, published_at: job.published_at,
    };
    write([card, ...read().filter((j) => j.id !== job.id)]);
    // view counter for the admin analytics: once per job per tab session (the API also dedups per visitor)
    try {
      const k = `hw_viewed_${job.id}`;
      if (!sessionStorage.getItem(k)) {
        sessionStorage.setItem(k, '1');
        fetch(`/api/v1/jobs/${job.id}/views`, { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch {
      /* storage blocked: skip counting rather than risk double counts */
    }
  }, [job]);
  return null;
}

export default function RecentlyViewed({ excludeId }: { excludeId?: string }) {
  const t = useTranslations('jobsPage');
  const tj = useTranslations('jobDetail');
  const f = latn(useFormatter());
  const locale = useLocale();
  const [jobs, setJobs] = useState<JobListItem[]>([]);

  useEffect(() => setJobs(read().filter((j) => j.id !== excludeId)), [excludeId]);

  if (jobs.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="recent-heading" className="flex items-center gap-2 text-base font-bold text-navy">
          <History className="h-5 w-5 text-brand" aria-hidden />
          {t('recentTitle')}
        </h2>
        <button
          type="button"
          onClick={() => { write([]); setJobs([]); }}
          className="inline-flex min-h-[44px] items-center gap-1 text-sm text-slate-500 hover:text-navy"
        >
          <X className="h-4 w-4" aria-hidden />
          {t('recentClear')}
        </button>
      </div>
      <ul className="-mx-4 mt-1 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
        {jobs.map((j) => {
          const pref = PREFECTURE_BY_ID.get(j.prefecture.id);
          return (
            <li key={j.id} className="w-60 shrink-0 snap-start">
              <Link href={`/jobs/${j.job_code}`} className="block h-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm hover:border-brand">
                <span className="line-clamp-2 text-sm font-bold text-navy">{localize(j.title, locale)}</span>
                <span className="mt-1 block text-sm font-bold text-brand">{salaryText(tj as unknown as Translate, (n) => f.number(n), j)}</span>
                <span className="block text-xs text-slate-500">{pref ? prefectureName(pref, locale) : localize(j.prefecture.name, locale)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
