import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Banknote, Languages, MapPin, TrainFront } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { isNewJob, localize, monthlyEstimate, salaryText, type JobListItem } from '@/lib/job';
import SaveJobButton from '@/components/saved/SaveJobButton';
import { latn } from '@/lib/format';

type Translate = (key: string, values: Record<string, string>) => string;

/** Job card for list pages. Haken end-client is not part of JobListItem, so it cannot appear here. */
export default function JobCard({ job }: { job: JobListItem }) {
  const t = useTranslations('jobDetail');
  const f = latn(useFormatter());
  const locale = useLocale();
  const pref = PREFECTURE_BY_ID.get(job.prefecture.id);
  const station = localize(job.nearest_station, locale);
  const monthly = monthlyEstimate(job);

  return (
    <div className="relative h-full">
      <Link
        href={`/jobs/${job.job_code}`}
        className="block h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="flex flex-wrap items-center gap-1.5 pr-10">
          <span className="inline-block rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-bold text-brand">
            {t(`employment.${job.employment_type}`)}
          </span>
          {isNewJob(job.published_at) && (
            <span className="inline-block rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold tracking-wide text-navy">
              {t('newBadge')}
            </span>
          )}
        </span>
        <h3 className="mt-2 pr-10 font-bold text-navy">{localize(job.title, locale)}</h3>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li className="flex items-center gap-2">
            <Banknote className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span className="font-bold text-brand">
              {salaryText(t as unknown as Translate, (n) => f.number(n), job)}
            </span>
          </li>
          {monthly && (
            <li className="pl-6 text-xs text-slate-500">{t('monthlyEstimateShort', { amount: f.number(monthly) })}</li>
          )}
          <li className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            {pref ? prefectureName(pref, locale) : localize(job.prefecture.name, locale)}
          </li>
          {station && (
            <li className="flex items-center gap-2">
              <TrainFront className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 break-words">{station}</span>
            </li>
          )}
          <li className="flex items-center gap-2">
            <Languages className="h-4 w-4 shrink-0 text-brand" aria-hidden />
            {t('japaneseLevel')}: {t(`level.${job.japanese_level_required}`)}
          </li>
        </ul>
        {job.features.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {job.features.map((k) => (
              <li key={k} className="rounded-full bg-navy-light px-2.5 py-0.5 text-xs text-navy">
                {t(`feature.${k}`)}
              </li>
            ))}
          </ul>
        )}
      </Link>
      {/* outside the <Link>: a button may not sit inside a link */}
      <SaveJobButton jobId={job.id} className="absolute right-2 top-2" />
    </div>
  );
}
