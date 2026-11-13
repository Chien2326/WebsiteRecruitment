'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { IntlMessageFormat } from 'intl-messageformat';
import { Check, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { ADMIN_LOCALES, placeholders, revalidate, type CmsBlock, type TranslationRow } from '@/lib/admin';
import type { I18nText } from '@/lib/job';
import { Card, Field, I18nField, Pagination, Spinner, Toggle, btn, input, useErrorText } from './ui';

type Bundled = Record<string, Record<string, string>>; // locale -> flat key -> text
const PAGE = 30;

export default function ContentAdmin({ bundled }: { bundled: Bundled }) {
  const t = useTranslations('admin.content');
  const [tab, setTab] = useState<'translations' | 'cms'>('translations');
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy">{t('title')}</h1>
      <div className="flex gap-2" role="tablist">
        {(['translations', 'cms'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[40px] rounded-lg px-4 text-sm font-bold ${tab === k ? 'bg-navy text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>
            {t(k)}
          </button>
        ))}
      </div>
      {tab === 'translations' ? <Translations bundled={bundled} /> : <CmsBlocks />}
    </div>
  );
}

/* ====================================================================== UI strings */
function Translations({ bundled }: { bundled: Bundled }) {
  const t = useTranslations('admin.content');
  const tc = useTranslations('admin.common');
  const errText = useErrorText();
  const [overrides, setOverrides] = useState<Record<string, string> | null>(null); // `${key}|${locale}` -> value
  const [target, setTarget] = useState('vi');
  const [ns, setNs] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'missing' | 'overridden'>('all');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api<TranslationRow[]>('/admin/translations')
      .then((rows) => setOverrides(Object.fromEntries(rows.map((r) => [`${r.key}|${r.locale}`, r.value]))))
      .catch(() => setOverrides({}));
  }, []);

  const base = bundled.ja;
  const keys = useMemo(() => Object.keys(base).filter((k) => !k.startsWith('admin.')).sort(), [base]); // admin UI is not end-user content
  const namespaces = useMemo(() => Array.from(new Set(keys.map((k) => k.split('.')[0]))), [keys]);

  const rows = useMemo(() => {
    if (!overrides) return [];
    const needle = q.trim().toLowerCase();
    return keys.filter((k) => {
      if (ns && !k.startsWith(`${ns}.`)) return false;
      const own = bundled[target]?.[k];
      const ov = overrides[`${k}|${target}`];
      if (filter === 'missing' && !(target !== 'ja' && (!own || own === base[k]) && !ov)) return false;
      if (filter === 'overridden' && ov === undefined) return false;
      if (!needle) return true;
      return [k, base[k], own ?? '', ov ?? ''].some((s) => s.toLowerCase().includes(needle));
    });
  }, [keys, ns, q, filter, target, overrides, bundled, base]);

  function validate(key: string, value: string): string | null {
    const need = placeholders(base[key]);
    const have = placeholders(value);
    const missing = [...need].filter((p) => !have.has(p));
    const extra = [...have].filter((p) => !need.has(p));
    if (missing.length || extra.length) return t('placeholderError', { expected: [...need].map((p) => `{${p}}`).join(' ') || '–' });
    try {
      new IntlMessageFormat(value, target).format(Object.fromEntries([...need].map((p) => [p, 1])));
    } catch {
      return t('syntaxError');
    }
    return null;
  }

  async function save(key: string) {
    const value = drafts[key];
    const problem = validate(key, value);
    setErrors((e) => ({ ...e, [key]: problem ?? '' }));
    if (problem) return;
    try {
      await api('/admin/translations', { method: 'PUT', json: { key, locale: target, value } });
      setOverrides((o) => ({ ...o, [`${key}|${target}`]: value }));
      setDrafts(({ [key]: _, ...rest }) => rest);
      await revalidate(['translations']);
    } catch (e) {
      setErrors((x) => ({ ...x, [key]: errText(e instanceof ApiError ? e.code : 'generic') }));
    }
  }

  async function revert(key: string) {
    await api(`/admin/translations?key=${encodeURIComponent(key)}&locale=${target}`, { method: 'DELETE' });
    setOverrides((o) => {
      if (!o) return o;
      const next = { ...o };
      delete next[`${key}|${target}`];
      return next;
    });
    await revalidate(['translations']);
  }

  if (!overrides) return <Spinner />;
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  return (
    <Card>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('targetLocale')}>
          <select className={input} value={target} onChange={(e) => { setTarget(e.target.value); setPage(1); setDrafts({}); }}>
            {ADMIN_LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label={t('namespace')}>
          <select className={input} value={ns} onChange={(e) => { setNs(e.target.value); setPage(1); }}>
            <option value="">{tc('all')}</option>
            {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label={tc('filter')}>
          <select className={input} value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setPage(1); }}>
            <option value="all">{t('filterAll')}</option>
            <option value="missing">{t('filterMissing')}</option>
            <option value="overridden">{t('filterOverridden')}</option>
          </select>
        </Field>
        <Field label={tc('search')}>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className={`${input} pl-8`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </span>
        </Field>
      </div>

      <ul className="divide-y divide-slate-100">
        {shown.length === 0 && <li className="py-8 text-center text-sm text-slate-500">{tc('noData')}</li>}
        {shown.map((k) => {
          const ov = overrides[`${k}|${target}`];
          const current = ov ?? bundled[target]?.[k] ?? '';
          const draft = drafts[k];
          return (
            <li key={k} className="grid gap-2 py-3 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="min-w-0">
                <code className="break-all text-xs text-slate-500">{k}</code>
                {ov !== undefined && <span className="ml-1 rounded bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{t('override')}</span>}
              </div>
              <p lang="ja" className="text-sm text-slate-600">{base[k]}</p>
              <div>
                <textarea
                  lang={target}
                  rows={Math.min(4, Math.max(1, Math.ceil((draft ?? current).length / 40)))}
                  className={`${input} py-1.5 ${errors[k] ? 'border-red-400' : ''}`}
                  value={draft ?? current}
                  onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                  aria-label={`${k} (${target})`}
                />
                {errors[k] && <p role="alert" className="mt-1 text-xs text-red-700">{errors[k]}</p>}
                <div className="mt-1 flex gap-2">
                  {draft !== undefined && draft !== current && (
                    <button type="button" className={`${btn.primary} min-h-[32px] px-3 text-xs`} onClick={() => void save(k)}>
                      <Check className="h-3.5 w-3.5" aria-hidden />{tc('save')}
                    </button>
                  )}
                  {ov !== undefined && (
                    <button type="button" className={`${btn.ghost} min-h-[32px] px-3 text-xs`} onClick={() => void revert(k)}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />{t('revert')}
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <Pagination page={page} pageSize={PAGE} total={rows.length} onPage={setPage} />
    </Card>
  );
}

/* ====================================================================== CMS blocks */
function CmsBlocks() {
  const t = useTranslations('admin.content');
  const tc = useTranslations('admin.common');
  const errText = useErrorText();
  const [blocks, setBlocks] = useState<CmsBlock[] | null>(null);
  const [edit, setEdit] = useState<{ key: string; content: I18nText; is_published: boolean; isNew: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<CmsBlock[]>('/admin/cms').then(setBlocks).catch(() => setBlocks([]));
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!edit) return;
    setErr(null);
    try {
      await api(`/admin/cms/${encodeURIComponent(edit.key)}`, { method: 'PUT', json: { content: edit.content, is_published: edit.is_published } });
      await revalidate(['cms']);
      setEdit(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    }
  }

  async function remove(key: string) {
    if (!window.confirm(tc('confirmDelete'))) return;
    await api(`/admin/cms/${encodeURIComponent(key)}`, { method: 'DELETE' });
    await revalidate(['cms']);
    await load();
  }

  if (!blocks) return <Spinner />;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card title={t('cms')} actions={
        <button type="button" className={btn.ghost} onClick={() => setEdit({ key: '', content: {}, is_published: false, isNew: true })}>
          <Plus className="h-4 w-4" aria-hidden />{t('cmsNew')}
        </button>
      }>
        <p className="mb-2 text-xs text-slate-500">{t('cmsHint')}</p>
        <ul className="divide-y divide-slate-100">
          {blocks.length === 0 && <li className="py-6 text-center text-sm text-slate-500">{tc('noData')}</li>}
          {blocks.map((b) => (
            <li key={b.key} className="flex items-center gap-2 py-2">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit({ key: b.key, content: b.content, is_published: b.is_published, isNew: false })}>
                <code className="text-sm font-bold text-navy">{b.key}</code>
                <span className="block truncate text-xs text-slate-500">{b.content.ja}</span>
              </button>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${b.is_published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {b.is_published ? t('published') : t('unpublished')}
              </span>
              <button type="button" onClick={() => void remove(b.key)} className="grid h-9 w-9 place-items-center rounded-lg text-red-600 hover:bg-red-50" aria-label={`${tc('delete')}: ${b.key}`}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {edit && (
        <Card title={edit.isNew ? t('cmsNew') : edit.key}>
          <div className="space-y-3">
            {edit.isNew && (
              <Field label={t('cmsKey')} hint={t('keyHint')}>
                <input className={input} pattern="[a-z0-9][a-z0-9._\-]{1,99}" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value.toLowerCase() })} placeholder="home.notice" />
              </Field>
            )}
            <I18nField label={t('cmsContent')} value={edit.content} onChange={(v) => setEdit({ ...edit, content: v })} multiline required />
            <div className="flex items-center gap-2 text-sm">
              <Toggle checked={edit.is_published} onChange={(v) => setEdit({ ...edit, is_published: v })} label={t('published')} />
              {edit.is_published ? t('published') : t('unpublished')}
            </div>
            {err && <p role="alert" className="text-sm text-red-700">{errText(err)}</p>}
            <div className="flex gap-2">
              <button type="button" className={btn.primary} disabled={!edit.key || !edit.content.ja} onClick={() => void save()}>
                <Check className="h-4 w-4" aria-hidden />{tc('save')}
              </button>
              <button type="button" className={btn.ghost} onClick={() => setEdit(null)}>{tc('cancel')}</button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
