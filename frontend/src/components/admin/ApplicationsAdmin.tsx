'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Download, Mail, Search, X } from 'lucide-react';
import { useSession } from '@/components/auth/SessionProvider';
import { ApiError, api, type ApplicationStatus } from '@/lib/api';
import {
  APP_STATUSES, can, qs, type AdminApplicationDetail, type AdminApplicationListItem, type Page,
} from '@/lib/admin';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { localize } from '@/lib/job';
import PdfViewer from './PdfViewer';
import { AppStatusPill, Card, Pagination, Spinner, btn, input, useErrorText } from './ui';
import { latn } from '@/lib/format';

const STATUSES: ApplicationStatus[] = ['applied', 'reviewing', 'interview', 'accepted', 'rejected'];

/** ISO 3166 code -> country name in the admin's language ("VN" -> ベトナム). Falls back to the code. */
function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export default function ApplicationsAdmin({ initialStatus, jobId }: { initialStatus?: string; jobId?: string }) {
  const t = useTranslations('admin');
  const tl = useTranslations('jobDetail.level');
  const locale = useLocale();
  const f = latn(useFormatter());
  const errText = useErrorText();
  const { user } = useSession();
  const [status, setStatus] = useState<ApplicationStatus | ''>(
    APP_STATUSES.includes(initialStatus as ApplicationStatus) ? (initialStatus as ApplicationStatus) : '',
  );
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<AdminApplicationListItem> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Page<AdminApplicationListItem>>(`/admin/applications${qs({ status, q, job_id: jobId, page, page_size: 20 })}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, page_size: 20 }));
  }, [status, q, jobId, page]);
  useEffect(load, [load]);

  useEffect(() => {
    if (!openId) return setDetail(null);
    setErr(null);
    api<AdminApplicationDetail>(`/admin/applications/${openId}`).then((d) => {
      setDetail(d);
      setNote(d.recruiter_note ?? '');
    });
  }, [openId]);

  async function changeStatus(s: ApplicationStatus) {
    if (!detail) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api<AdminApplicationDetail>(`/admin/applications/${detail.id}/status`, {
        method: 'PATCH', json: { status: s, recruiter_note: note, notify },
      });
      setDetail(d);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    } finally {
      setBusy(false);
    }
  }

  async function download(id: string) {
    const { url } = await api<{ url: string }>(`/resumes/${id}/download-url`);
    window.location.href = url; // attachment disposition: downloads, never renders in our origin
  }

  const p = detail?.profile;
  const pref = p?.current_prefecture_id ? PREFECTURE_BY_ID.get(p.current_prefecture_id) : undefined;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">{t('apps.title')}</h1>

      <div className="flex flex-wrap gap-2">
        {(['', ...APP_STATUSES] as const).map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => { setStatus(s); setPage(1); }}
            aria-pressed={status === s}
            className={`min-h-[36px] rounded-full px-3 text-xs font-bold ring-1 ${status === s ? 'bg-navy text-white ring-navy' : 'bg-white text-slate-700 ring-slate-300'}`}
          >
            {s ? <StatusLabel s={s} /> : t('common.all')}
          </button>
        ))}
        <label className="relative ml-auto min-w-[220px] flex-1 sm:flex-none">
          <span className="sr-only">{t('common.search')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className={`${input} pl-8`} placeholder={t('apps.searchHint')} value={q} maxLength={100} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {!data ? <Spinner /> : (
            <>
              <ul className="divide-y divide-slate-100">
                {data.items.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-500">{t('common.noData')}</li>}
                {data.items.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(a.id)}
                      aria-current={openId === a.id}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${openId === a.id ? 'bg-navy-light' : ''}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-navy">{a.candidate.display_name}</span>
                          <AppStatusPill status={a.status} />
                          {a.status === 'applied' && <span className="h-2 w-2 rounded-full bg-brand" aria-label="new" />}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-600">{a.job_code} ・ {localize(a.job_title, locale)}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-slate-500">
                        {f.dateTime(new Date(a.created_at), { dateStyle: 'short' })}
                        <span className="block">{tl(a.candidate.japanese_level)}{a.has_resume ? ' ・ CV' : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-slate-100 px-3 pb-3">
                <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} />
              </div>
            </>
          )}
        </div>

        {/* detail: side panel on wide screens, full-screen sheet on phones */}
        {openId && (
          <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-50 p-4 xl:static xl:z-auto xl:overflow-visible xl:bg-transparent xl:p-0">
            {!detail ? <Spinner /> : (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-navy">{detail.candidate.display_name}</h2>
                    <p className="text-xs text-slate-600">{detail.candidate.email} ・ {detail.job_code}</p>
                  </div>
                  <button type="button" onClick={() => setOpenId(null)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-200" aria-label={t('common.close')}>
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                {can(user, 'applications.update') && (
                  <Card title={t('apps.changeStatus')}>
                    <div className="flex flex-wrap gap-2">
                      {APP_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={busy || detail.status === s}
                          onClick={() => void changeStatus(s)}
                          className={`min-h-[40px] rounded-lg px-3 text-xs font-bold ring-1 disabled:cursor-default ${
                            detail.status === s ? 'bg-navy text-white ring-navy' : 'bg-white text-slate-700 ring-slate-300 hover:ring-navy'
                          }`}
                        >
                          <StatusLabel s={s} />
                        </button>
                      ))}
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-bold text-slate-600">{t('apps.recruiterNote')}</span>
                      <textarea rows={2} maxLength={3000} className={`${input} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" className="h-4 w-4 accent-navy" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                      <Mail className="h-4 w-4 text-slate-500" aria-hidden />{t('apps.notify')}
                    </label>
                    {err && <p role="alert" className="mt-2 text-sm text-red-700">{errText(err)}</p>}
                  </Card>
                )}

                <Card title={t('apps.profile')}>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-slate-500">{t('apps.nationality')}</dt><dd>{p?.nationality ? countryName(p.nationality, locale) : '–'}</dd>
                    <dt className="text-slate-500">{t('apps.level')}</dt><dd>{detail.candidate.japanese_level === 'none' ? t('apps.levelNone') : tl(detail.candidate.japanese_level)}</dd>
                    <dt className="text-slate-500">{t('apps.visa')}</dt><dd>{p?.visa_type ? localize(p.visa_type.name, locale) : '–'}</dd>
                    <dt className="text-slate-500">{t('apps.phone')}</dt><dd>{p?.phone ?? '–'}</dd>
                    <dt className="text-slate-500">{t('apps.location')}</dt><dd>{pref ? prefectureName(pref, locale) : '–'}</dd>
                    <dt className="text-slate-500">{t('apps.experience')}</dt><dd>{p ? t('apps.years', { n: p.years_of_experience }) : '–'}</dd>
                  </dl>
                  {p?.experience_summary && <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{p.experience_summary}</p>}
                  {detail.cover_message && (
                    <div className="mt-3">
                      <p className="text-xs font-bold text-slate-600">{t('apps.coverMessage')}</p>
                      <p className="mt-1 whitespace-pre-line text-sm">{detail.cover_message}</p>
                    </div>
                  )}
                </Card>

                <Card
                  title={t('apps.resume')}
                  actions={detail.resume && can(user, 'resumes.read') ? (
                    <button type="button" className={btn.ghost} onClick={() => void download(detail.resume!.id)}>
                      <Download className="h-4 w-4" aria-hidden />{t('apps.download')}
                    </button>
                  ) : undefined}
                >
                  {!detail.resume ? (
                    <p className="text-sm text-slate-500">{t('apps.noResume')}</p>
                  ) : detail.resume.file_type === 'pdf' ? (
                    <PdfViewer resumeId={detail.resume.id} />
                  ) : (
                    <p className="text-sm text-slate-600">{detail.resume.original_filename} — {t('apps.docxNote')}</p>
                  )}
                </Card>

                <Card title={t('apps.emails')}>
                  {detail.emails.length === 0 ? <p className="text-sm text-slate-500">–</p> : (
                    <ul className="space-y-1 text-xs">
                      {detail.emails.map((e) => (
                        <li key={e.created_at} className="flex justify-between gap-2">
                          {/* template "application_<status>" = the status-change mail the candidate received */}
                          <span className="flex items-center gap-1.5">
                            {STATUSES.includes(e.template.replace('application_', '') as ApplicationStatus)
                              ? <AppStatusPill status={e.template.replace('application_', '') as ApplicationStatus} />
                              : e.template}
                          </span>
                          <span className={e.status === 'sent' ? 'text-emerald-700' : e.status === 'failed' ? 'text-red-700' : 'text-slate-500'}>
                            {['queued', 'sent', 'failed'].includes(e.status) ? t(`apps.emailStatus.${e.status}`) : e.status} ・ {f.dateTime(new Date(e.created_at), { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title={t('apps.history')}>
                  <ol className="relative space-y-3 border-l border-slate-200 pl-4">
                    {detail.history.map((h, i) => (
                      <li key={`${h.created_at}-${i}`} className="text-xs">
                        <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white bg-navy" aria-hidden />
                        <span className="flex flex-wrap items-center gap-2">
                          <AppStatusPill status={h.to_status as ApplicationStatus} />
                          <span className="text-slate-500">{f.dateTime(new Date(h.created_at), { dateStyle: 'short', timeStyle: 'short' })}</span>
                        </span>
                        <span className="mt-0.5 block text-slate-500">{h.changed_by ?? t('apps.deletedUser')}</span>
                      </li>
                    ))}
                  </ol>
                </Card>

                {detail.resume_access && (
                  <Card title={t('apps.resumeAccess')}>
                    {detail.resume_access.length === 0 ? <p className="text-sm text-slate-500">–</p> : (
                      <ul className="space-y-1 text-xs">
                        {detail.resume_access.map((a, i) => (
                          <li key={`${a.created_at}-${i}`} className="flex flex-wrap justify-between gap-2">
                            <span className="break-all">{a.accessed_by ?? t('apps.deletedUser')} <span className="text-slate-400">({t(`roles.${a.role}`)})</span></span>
                            <span className="text-slate-500">{a.inline ? t('apps.viewed') : t('apps.downloaded')} ・ {f.dateTime(new Date(a.created_at), { dateStyle: 'short', timeStyle: 'short' })}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusLabel({ s }: { s: ApplicationStatus }) {
  const t = useTranslations('status');
  return <>{t(s)}</>;
}
