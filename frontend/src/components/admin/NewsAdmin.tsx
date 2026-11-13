'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, ExternalLink, Eye, Plus, Search, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { qs, revalidate, type Page } from '@/lib/admin';
import { CONTENT_STATUSES, type ContentStatus, type NewsAdmin as News } from '@/lib/content';
import { localize, type I18nText } from '@/lib/job';
import RichText from '@/components/RichText';
import { Link } from '@/i18n/navigation';
import { Card, Field, I18nField, Pagination, Spinner, btn, input, useErrorText, EmptyPane } from './ui';
import { latn } from '@/lib/format';

const PAGE = 20;
const STATUS_CLS: Record<ContentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-300',
  published: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  archived: 'bg-zinc-200 text-zinc-600 ring-zinc-300',
};

type Draft = {
  id: string | null;
  slug: string;
  title: I18nText;
  summary: I18nText;
  body: I18nText;
  status: ContentStatus;
  published_at: string; // datetime-local value ('' = now when publishing)
};

const EMPTY: Draft = { id: null, slug: '', title: {}, summary: {}, body: {}, status: 'draft', published_at: '' };

/** ISO -> value for <input type="datetime-local"> in the browser's time zone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A readable default slug: date + short random part (titles are often Japanese, so no transliteration). */
function suggestSlug(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function NewsAdmin() {
  const t = useTranslations('admin.news');
  const ta = useTranslations('admin');
  const tc = useTranslations('admin.common');
  const f = latn(useFormatter());
  const errText = useErrorText();
  const [data, setData] = useState<Page<News> | null>(null);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewLang, setPreviewLang] = useState('ja');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Page<News>>(`/admin/news${qs({ status, q, page, page_size: PAGE })}`)
      .then(setData)
      .catch(() => setData({ items: [], total: 0, page: 1, page_size: PAGE }));
  }, [status, q, page]);
  useEffect(load, [load]);

  function open(n: News) {
    setErr(null);
    setPreview(false);
    setEdit({
      id: n.id, slug: n.slug, title: n.title, summary: n.summary ?? {}, body: n.body, status: n.status,
      published_at: toLocalInput(n.published_at),
    });
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    const payload = {
      slug: edit.slug, title: edit.title, summary: edit.summary, body: edit.body, status: edit.status,
      published_at: edit.published_at ? new Date(edit.published_at).toISOString() : null,
    };
    try {
      const saved = edit.id
        ? await api<News>(`/admin/news/${edit.id}`, { method: 'PUT', json: payload })
        : await api<News>('/admin/news', { method: 'POST', json: payload });
      await revalidate(['news']);
      open(saved);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    } finally {
      setBusy(false);
    }
  }

  async function remove(n: { id: string | null }) {
    if (!n.id || !window.confirm(tc('confirmDelete'))) return;
    await api(`/admin/news/${n.id}`, { method: 'DELETE' });
    await revalidate(['news']);
    setEdit(null);
    load();
  }

  const scheduled = (n: { status: ContentStatus; published_at: string | null }) =>
    n.status === 'published' && !!n.published_at && new Date(n.published_at) > new Date();
  const slugOk = /^[a-z0-9-]{3,120}$/.test(edit?.slug ?? '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-navy">{t('title')}</h1>
        <button type="button" className={btn.primary} onClick={() => { setErr(null); setPreview(false); setEdit({ ...EMPTY, slug: suggestSlug() }); }}>
          <Plus className="h-4 w-4" aria-hidden />{t('new')}
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <Field label={tc('filter')}>
              <select className={input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">{tc('all')}</option>
                {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={tc('search')}>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className={`${input} pl-8`} placeholder={t('searchPlaceholder')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
              </span>
            </Field>
          </div>
          {!data ? <Spinner /> : (
            <>
              <ul className="divide-y divide-slate-100">
                {data.items.length === 0 && <li className="py-8 text-center text-sm text-slate-500">{tc('noData')}</li>}
                {data.items.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => open(n)}
                      className={`block w-full py-3 text-left hover:bg-slate-50 ${edit?.id === n.id ? 'bg-navy/5' : ''}`}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${STATUS_CLS[n.status]}`}>
                          {scheduled(n) ? t('scheduled') : t(`status.${n.status}`)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {n.published_at ? f.dateTime(new Date(n.published_at), { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                        </span>
                      </span>
                      <span lang="ja" className="mt-1 block font-bold text-navy">{localize(n.title, 'ja')}</span>
                      <code className="text-xs text-slate-500">/news/{n.slug}</code>
                    </button>
                  </li>
                ))}
              </ul>
              <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </>
          )}
        </Card>

        {!edit && <EmptyPane text={ta('common.selectHint')} />}
        {edit && (
          <Card
            title={edit.id ? t('edit') : t('new')}
            actions={
              <span className="flex gap-2">
                <button type="button" className={btn.ghost} onClick={() => setPreview((p) => !p)} aria-pressed={preview}>
                  <Eye className="h-4 w-4" aria-hidden />{t('preview')}
                </button>
                {edit.id && edit.status === 'published' && !scheduled(edit) && (
                  <Link href={`/news/${edit.slug}`} target="_blank" className={btn.ghost}>
                    <ExternalLink className="h-4 w-4" aria-hidden />{t('view')}
                  </Link>
                )}
              </span>
            }
          >
            {preview ? (
              <div>
                <div className="mb-3 flex flex-wrap gap-1">
                  {Object.keys(edit.body).map((l) => (
                    <button key={l} type="button" onClick={() => setPreviewLang(l)}
                      className={`rounded-md px-2 py-1 text-xs font-bold ${previewLang === l ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`}>
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                <h2 className="text-lg font-bold text-navy">{localize(edit.title, previewLang)}</h2>
                <div className="mt-3 rounded-xl border border-slate-200 p-4">
                  <RichText text={localize(edit.body, previewLang)} lang={edit.body[previewLang] ? previewLang : 'ja'} />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <I18nField label={t('fieldTitle')} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} required />
                <I18nField label={t('fieldSummary')} value={edit.summary} onChange={(v) => setEdit({ ...edit, summary: v })} hint={t('summaryHint')} />
                <I18nField label={t('fieldBody')} value={edit.body} onChange={(v) => setEdit({ ...edit, body: v })} multiline required hint={t('formatHint')} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t('fieldSlug')} hint={t('slugHint')} className="sm:col-span-3">
                    <input className={`${input} ${edit.slug && !slugOk ? 'border-red-400' : ''}`} value={edit.slug}
                      onChange={(e) => setEdit({ ...edit, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                  </Field>
                  <Field label={t('fieldStatus')}>
                    <select className={input} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as ContentStatus })}>
                      {CONTENT_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('fieldPublishedAt')} hint={t('publishedAtHint')} className="sm:col-span-2">
                    <input type="datetime-local" className={input} value={edit.published_at}
                      onChange={(e) => setEdit({ ...edit, published_at: e.target.value })} />
                  </Field>
                </div>
              </div>
            )}
            {err && <p role="alert" className="mt-3 text-sm text-red-700">{errText(err)}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={btn.primary} disabled={busy || !slugOk || !edit.title.ja || !edit.body.ja} onClick={() => void save()}>
                <Check className="h-4 w-4" aria-hidden />{tc('save')}
              </button>
              <button type="button" className={btn.ghost} onClick={() => setEdit(null)}>{tc('close')}</button>
              {edit.id && (
                <button type="button" className={`${btn.danger} ml-auto`} onClick={() => void remove(edit)}>
                  <Trash2 className="h-4 w-4" aria-hidden />{tc('delete')}
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
