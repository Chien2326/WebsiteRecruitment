'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Plus, Search } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSession } from '@/components/auth/SessionProvider';
import { api } from '@/lib/api';
import { JOB_STATUSES, can, qs, type AdminJobListItem, type JobStatus, type Page } from '@/lib/admin';
import { PREFECTURES, PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { localize } from '@/lib/job';
import { JobStatusPill, Pagination, Spinner, btn, input } from './ui';
import { latn } from '@/lib/format';

type Filters = { status: JobStatus | ''; prefecture_id: string; created_from: string; created_to: string; q: string };

export default function JobsList({ initialStatus }: { initialStatus?: string }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const f = latn(useFormatter());
  const router = useRouter();
  const { user } = useSession();
  const [filters, setFilters] = useState<Filters>({
    status: JOB_STATUSES.includes(initialStatus as JobStatus) ? (initialStatus as JobStatus) : '',
    prefecture_id: '', created_from: '', created_to: '', q: '',
  });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminJobListItem> | null>(null);

  const load = useCallback(() => {
    api<Page<AdminJobListItem>>(`/admin/jobs${qs({ ...filters, page, page_size: 20 })}`).then(setData).catch(() =>
      setData({ items: [], total: 0, page: 1, page_size: 20 }),
    );
  }, [filters, page]);
  useEffect(load, [load]);

  const set = (k: keyof Filters, v: string) => {
    setFilters((p) => ({ ...p, [k]: v }));
    setPage(1);
  };
  const salary = (j: AdminJobListItem) =>
    `${f.number(j.salary_min)}${j.salary_max ? `〜${f.number(j.salary_max)}` : '〜'}円/${j.salary_type === 'hourly' ? t('editor.hourly') : t('editor.monthly')}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-navy">{t('jobs.title')}</h1>
        {can(user, 'jobs.write') && (
          <Link href="/admin/jobs/new" className={btn.brand}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('jobs.new')}
          </Link>
        )}
      </div>

      {/* filters */}
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="relative lg:col-span-2">
          <span className="sr-only">{t('jobs.keyword')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className={`${input} pl-8`} placeholder={t('jobs.keyword')} value={filters.q} onChange={(e) => set('q', e.target.value)} maxLength={100} />
        </label>
        <select aria-label={t('jobs.filterStatus')} className={input} value={filters.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">{t('jobs.filterStatus')}: {t('common.all')}</option>
          {JOB_STATUSES.map((s) => <option key={s} value={s}>{t(`jobStatus.${s}`)}</option>)}
        </select>
        <select aria-label={t('jobs.filterPrefecture')} className={input} value={filters.prefecture_id} onChange={(e) => set('prefecture_id', e.target.value)}>
          <option value="">{t('jobs.filterPrefecture')}: {t('common.all')}</option>
          {PREFECTURES.map((p) => <option key={p.id} value={p.id}>{prefectureName(p, locale)}</option>)}
        </select>
        {/* min-w-0: date inputs have a large intrinsic width and would push out of the card */}
        <div className="flex min-w-0 items-center gap-1 sm:col-span-2">
          <input type="date" aria-label={t('jobs.from')} className={`${input} min-w-0 flex-1`} value={filters.created_from} onChange={(e) => set('created_from', e.target.value)} />
          <span className="text-slate-400">–</span>
          <input type="date" aria-label={t('jobs.to')} className={`${input} min-w-0 flex-1`} value={filters.created_to} onChange={(e) => set('created_to', e.target.value)} />
        </div>
      </div>

      {!data ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm sm:min-w-[760px]">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">{t('jobs.code')}</th>
                  <th className="px-3 py-2 font-medium">{t('jobs.jobTitle')}</th>
                  <th className="px-3 py-2 font-medium">{t('jobs.status')}</th>
                  <th className="px-3 py-2 font-medium">{t('jobs.prefecture')}</th>
                  <th className="px-3 py-2 font-medium">{t('jobs.salary')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('jobs.views')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('jobs.applications')}</th>
                  <th className="px-3 py-2 font-medium">{t('jobs.created')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">{t('common.noData')}</td></tr>
                )}
                {data.items.map((j) => {
                  const pref = PREFECTURE_BY_ID.get(j.prefecture_id);
                  return (
                    <tr key={j.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/admin/jobs/${j.id}`)}>
                      <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500 sm:table-cell">{j.job_code}</td>
                      <td className="max-w-[320px] px-3 py-2">
                        <Link href={`/admin/jobs/${j.id}`} className="line-clamp-2 font-medium text-navy hover:underline" onClick={(e) => e.stopPropagation()}>
                          {localize(j.title, locale)}
                        </Link>
                        {/* phones: the code column is hidden, so show the code under the title */}
                        <span className="font-mono text-[11px] text-slate-500 sm:hidden">{j.job_code}</span>
                      </td>
                      <td className="px-3 py-2"><JobStatusPill status={j.status} /></td>
                      <td className="whitespace-nowrap px-3 py-2">{pref ? prefectureName(pref, locale) : j.prefecture_id}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{salary(j)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{f.number(j.view_count ?? 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {j.applications_count > 0 ? (
                          <Link href={`/admin/applications?job_id=${j.id}`} onClick={(e) => e.stopPropagation()} className="font-bold text-brand hover:underline">
                            {j.applications_count}
                          </Link>
                        ) : 0}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{f.dateTime(new Date(j.created_at), { dateStyle: 'medium' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-3 pb-3">
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </div>
        </div>
      )}
    </div>
  );
}
