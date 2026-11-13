'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Building2, Check, Mail, Phone, Search, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { qs, type Page } from '@/lib/admin';
import { INQUIRY_STATUSES, type EmployerInquiry, type InquiryStatus } from '@/lib/content';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { Card, Field, Pagination, Spinner, btn, input, useErrorText, EmptyPane } from './ui';
import { latn } from '@/lib/format';

const PAGE = 20;
const STATUS_CLS: Record<InquiryStatus, string> = {
  new: 'bg-sky-50 text-sky-700 ring-sky-200',
  contacted: 'bg-amber-50 text-amber-800 ring-amber-200',
  closed: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function InquiriesAdmin() {
  const t = useTranslations('admin.inquiries');
  const ta = useTranslations('admin');
  const tc = useTranslations('admin.common');
  const f = latn(useFormatter());
  const errText = useErrorText();
  const [data, setData] = useState<Page<EmployerInquiry> | null>(null);
  const [status, setStatus] = useState<string>('new');
  const [kind, setKind] = useState<string>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<EmployerInquiry | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Page<EmployerInquiry>>(`/admin/inquiries${qs({ status, kind, q, page, page_size: PAGE })}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, page_size: PAGE }));
  }, [status, kind, q, page]);
  useEffect(load, [load]);

  function open(i: EmployerInquiry) {
    setSel(i);
    setNote(i.admin_note ?? '');
    setErr(null);
  }

  async function patch(body: { status?: InquiryStatus; admin_note?: string }) {
    if (!sel) return;
    setErr(null);
    try {
      const saved = await api<EmployerInquiry>(`/admin/inquiries/${sel.id}`, { method: 'PATCH', json: body });
      open(saved);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    }
  }

  async function remove() {
    if (!sel || !window.confirm(t('confirmDelete'))) return;
    await api(`/admin/inquiries/${sel.id}`, { method: 'DELETE' });
    setSel(null);
    load();
  }

  const pref = (id: number | null) => {
    const p = id ? PREFECTURE_BY_ID.get(id) : undefined;
    return p ? prefectureName(p, 'ja') : '—';
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">{t('title')}</h1>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <Field label={t('kindLabel')}>
              <select className={input} value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
                <option value="">{tc('all')}</option>
                <option value="employer">{t('kind.employer')}</option>
                <option value="general">{t('kind.general')}</option>
              </select>
            </Field>
            <Field label={tc('filter')}>
              <select className={input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">{tc('all')}</option>
                {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={tc('search')}>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className={`${input} pl-8`} value={q} placeholder={t('searchHint')} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              </span>
            </Field>
          </div>
          {!data ? <Spinner /> : (
            <>
              <ul className="divide-y divide-slate-100">
                {data.items.length === 0 && <li className="py-8 text-center text-sm text-slate-500">{tc('noData')}</li>}
                {data.items.map((i) => (
                  <li key={i.id}>
                    <button type="button" onClick={() => open(i)} className={`block w-full py-3 text-left hover:bg-slate-50 ${sel?.id === i.id ? 'bg-navy/5' : ''}`}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${STATUS_CLS[i.status]}`}>{t(`status.${i.status}`)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t(`kind.${i.kind}`)}</span>
                        <span className="text-xs text-slate-500">{f.dateTime(new Date(i.created_at), { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </span>
                      <span className="mt-1 block font-bold text-navy">{i.company_name ?? i.contact_name}</span>
                      <span className="block text-xs text-slate-500">{i.contact_name} ・ {pref(i.prefecture_id)}{i.headcount ? ` ・ ${t('people', { n: i.headcount })}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </>
          )}
        </Card>

        {!sel && <EmptyPane text={ta('common.selectHint')} />}
        {sel && (
          <Card title={<span className="inline-flex items-center gap-2"><Building2 className="h-4 w-4" aria-hidden />{sel.company_name ?? sel.contact_name}</span>}>
            <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
              <dt className="text-slate-500">{t('contact')}</dt><dd>{sel.contact_name}</dd>
              <dt className="text-slate-500">{t('email')}</dt>
              <dd><a href={`mailto:${sel.email}`} className="inline-flex items-center gap-1 break-all text-navy underline"><Mail className="h-3.5 w-3.5" aria-hidden />{sel.email}</a></dd>
              <dt className="text-slate-500">{t('phone')}</dt>
              <dd>{sel.phone ? <a href={`tel:${sel.phone.replace(/[^0-9+]/g, '')}`} className="inline-flex items-center gap-1 text-navy underline"><Phone className="h-3.5 w-3.5" aria-hidden />{sel.phone}</a> : '—'}</dd>
              <dt className="text-slate-500">{t('prefecture')}</dt><dd>{pref(sel.prefecture_id)}</dd>
              <dt className="text-slate-500">{t('headcount')}</dt><dd>{sel.headcount ? t('people', { n: sel.headcount }) : '—'}</dd>
              <dt className="text-slate-500">{t('language')}</dt><dd>{sel.locale.toUpperCase()}</dd>
              <dt className="text-slate-500">{t('received')}</dt><dd>{f.dateTime(new Date(sel.created_at), { dateStyle: 'long', timeStyle: 'short' })}</dd>
            </dl>
            <h3 className="mt-4 text-xs font-bold text-slate-600">{t('message')}</h3>
            {/* plain text node: visitor input is never rendered as HTML */}
            <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{sel.message}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <Field label={t('statusLabel')}>
                <select className={input} value={sel.status} onChange={(e) => void patch({ status: e.target.value as InquiryStatus })}>
                  {INQUIRY_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                </select>
              </Field>
              <Field label={t('note')} hint={t('noteHint')}>
                <textarea rows={3} maxLength={2000} className={`${input} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            {err && <p role="alert" className="mt-2 text-sm text-red-700">{errText(err)}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btn.primary} disabled={note === (sel.admin_note ?? '')} onClick={() => void patch({ admin_note: note })}>
                <Check className="h-4 w-4" aria-hidden />{tc('save')}
              </button>
              <button type="button" className={btn.ghost} onClick={() => setSel(null)}>{tc('close')}</button>
              <button type="button" className={`${btn.danger} ml-auto`} onClick={() => void remove()}>
                <Trash2 className="h-4 w-4" aria-hidden />{tc('delete')}
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
