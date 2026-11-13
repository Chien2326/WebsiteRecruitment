import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Banknote, Building2, CalendarClock, Clock, Home, IdCard, Languages, MapPin, TrainFront } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import QuickApply from '@/components/apply/QuickApply';
import SaveJobButton from '@/components/saved/SaveJobButton';
import JobCard from '@/components/JobCard';
import RecentlyViewed, { TrackJobView } from '@/components/jobs/RecentlyViewed';
import ShareButtons from '@/components/jobs/ShareButtons';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { getJob, getSimilarJobs, isNewJob, localize, monthlyEstimate, type JobPublic } from '@/lib/job';
import { latn } from '@/lib/format';

type Props = { params: { locale: string; id: string } };

export async function generateMetadata({ params: { locale, id } }: Props) {
  const job = await getJob(id);
  return { title: job ? localize(job.title, locale) : undefined };
}

const SCHEMA_EMPLOYMENT: Record<JobPublic['employment_type'], string> = {
  haken: 'TEMPORARY', part_time: 'PART_TIME', full_time: 'FULL_TIME', contract: 'CONTRACTOR',
};

/**
 * schema.org JobPosting (Google for Jobs). Haken rule: the hiring organization is OUR company (site name),
 * never the end client - that name is not even in the data this page receives.
 */
function jobPostingJsonLd(job: JobPublic, locale: string, siteName: string) {
  const p = PREFECTURE_BY_ID.get(job.prefecture.id);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: localize(job.title, locale),
    description: localize(job.description, locale),
    identifier: { '@type': 'PropertyValue', name: siteName, value: job.job_code },
    datePosted: job.published_at,
    ...(job.expires_at ? { validThrough: job.expires_at } : {}),
    employmentType: SCHEMA_EMPLOYMENT[job.employment_type],
    hiringOrganization: { '@type': 'Organization', name: siteName },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressRegion: p ? prefectureName(p, 'ja') : localize(job.prefecture.name, 'ja'),
        ...(job.city ? { addressLocality: localize(job.city, 'ja') } : {}),
        addressCountry: 'JP',
      },
    },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'JPY',
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.salary_min,
        ...(job.salary_max ? { maxValue: job.salary_max } : {}),
        unitText: job.salary_type === 'hourly' ? 'HOUR' : 'MONTH',
      },
    },
  };
  // "<" escaped so text from the database can never close the <script> tag
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function Card({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
        <span className="text-brand" aria-hidden>{icon}</span>
        {label}
      </h2>
      <div className="mt-2 text-base">{children}</div>
    </section>
  );
}

export default async function JobDetailPage({ params: { locale, id } }: Props) {
  setRequestLocale(locale);
  const job = await getJob(id);
  if (!job) notFound();

  const t = await getTranslations('jobDetail');
  const tc = await getTranslations('common');
  const f = latn(await getFormatter());
  const similar = await getSimilarJobs(job.job_code, 4);
  const monthly = monthlyEstimate(job);
  const station = localize(job.nearest_station, locale);
  const title = localize(job.title, locale);

  const min = f.number(job.salary_min);
  const max = job.salary_max ? f.number(job.salary_max) : null;
  const salaryKey = job.salary_type === 'hourly' ? 'salaryHourly' : 'salaryMonthly';
  const salary = max ? t(salaryKey, { min, max }) : t(`${salaryKey}From`, { min });

  return (
    <article>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jobPostingJsonLd(job, locale, tc('siteName')) }} />
      <TrackJobView job={job} />
      <Link href="/jobs" className="inline-flex min-h-[44px] items-center text-sm text-navy hover:underline">
        ← {t('backToList')}
      </Link>

      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand">
            {t(`employment.${job.employment_type}`)}
          </span>
          {isNewJob(job.published_at) && (
            <span className="inline-block rounded-full bg-amber-400 px-2.5 py-1 text-xs font-bold text-navy">{t('newBadge')}</span>
          )}
        </div>
        {/* min-h / no fixed height: Myanmar & Indic headings need the extra vertical room */}
        <h1 className="mt-2 text-xl font-bold text-navy md:text-2xl">{title}</h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            {t('jobCode')}: {job.job_code} ・ {t('postedOn')}: {f.dateTime(new Date(job.published_at), { dateStyle: 'medium' })}
          </p>
          <SaveJobButton jobId={job.id} withLabel />
        </div>
      </header>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Card icon={<Banknote className="h-4 w-4" />} label={t('salary')}>
          <p className="text-lg font-bold text-brand">{salary}</p>
          {job.transport_fee_included && <p className="text-sm text-slate-600">{t('transportIncluded')}</p>}
          {monthly && (
            <div className="mt-2 rounded-xl bg-amber-50 p-2.5">
              <p className="text-sm font-bold text-navy">{t('monthlyEstimate', { amount: f.number(monthly) })}</p>
              <p className="text-xs text-slate-600">{t('monthlyEstimateNote', { hours: job.work_hours_per_week ?? 0 })}</p>
            </div>
          )}
        </Card>

        <Card icon={<MapPin className="h-4 w-4" />} label={t('location')}>
          {(() => {
            const p = PREFECTURE_BY_ID.get(job.prefecture.id);
            return p ? prefectureName(p, locale) : localize(job.prefecture.name, locale);
          })()}
          {job.city && ` ${localize(job.city, locale)}`}
          {station && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-700">
              <TrainFront className="h-4 w-4 shrink-0 text-brand" aria-hidden />
              {t('nearestStation')}: {station}
            </p>
          )}
        </Card>

        <Card icon={<Clock className="h-4 w-4" />} label={t('shift')}>
          <p>{localize(job.work_shift, locale)}</p>
          {job.work_hours_per_week && <p className="text-sm text-slate-600">{t('hoursPerWeek', { hours: job.work_hours_per_week })}</p>}
        </Card>

        <Card icon={<Languages className="h-4 w-4" />} label={t('japaneseLevel')}>
          {t(`level.${job.japanese_level_required}`)}
        </Card>

        <Card icon={<IdCard className="h-4 w-4" />} label={t('visa')}>
          <ul className="flex flex-wrap gap-2">
            {job.visa_types.map((v) => (
              <li key={v.id} className="rounded-full bg-navy-light px-3 py-1 text-sm">{localize(v.name, locale)}</li>
            ))}
          </ul>
        </Card>

        {job.expires_at && (
          <Card icon={<CalendarClock className="h-4 w-4" />} label={t('deadline')}>
            <p className="font-bold">{f.dateTime(new Date(job.expires_at), { dateStyle: 'long' })}</p>
            <p className="text-sm text-slate-600">{t('deadlineNote')}</p>
          </Card>
        )}

        <Card icon={<Home className="h-4 w-4" />} label={t('features')}>
          <ul className="flex flex-wrap gap-2">
            {job.features.map((k) => (
              <li key={k} className="rounded-full bg-brand-light px-3 py-1 text-sm">{t(`feature.${k}`)}</li>
            ))}
          </ul>
        </Card>
      </div>

      <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-navy">{t('description')}</h2>
        <p className="mt-2 whitespace-pre-line">{localize(job.description, locale)}</p>
      </section>

      {/* Haken: end-client is NEVER sent to the browser. Label comes from i18n, not from data. */}
      <Card icon={<Building2 className="h-4 w-4" />} label={t('client')}>
        {job.client_display_name && localize(job.client_display_name, locale) && (
          <p className="font-bold text-navy">{localize(job.client_display_name, locale)}</p>
        )}
        <p className="text-sm text-slate-600">{t('clientHidden')}</p>
      </Card>

      <div className="mt-3">
        <ShareButtons title={title} />
      </div>

      {similar.length > 0 && (
        <section aria-labelledby="similar-heading" className="mt-6">
          <h2 id="similar-heading" className="text-lg font-bold text-navy">{t('similarTitle')}</h2>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {similar.map((j) => <li key={j.id}><JobCard job={j} /></li>)}
          </ul>
        </section>
      )}

      <div className="mt-6">
        <RecentlyViewed excludeId={job.id} />
      </div>

      {/* sticky bottom CTA = thumb-friendly on mobile */}
      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <QuickApply jobId={job.id} jobCode={job.job_code} />
      </div>
    </article>
  );
}
