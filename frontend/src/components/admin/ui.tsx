'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { ApplicationStatus } from '@/lib/api';
import { ADMIN_LOCALES, type JobStatus } from '@/lib/admin';
import type { I18nText } from '@/lib/job';

export const input =
  'min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/20 disabled:bg-slate-100';
export const btn = {
  primary: 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-navy px-4 text-sm font-bold text-white hover:bg-navy/90 disabled:opacity-50',
  brand: 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50',
  ghost: 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50',
  danger: 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50',
};

const JOB_STATUS_CLS: Record<JobStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-300',
  pending: 'bg-amber-50 text-amber-800 ring-amber-300',
  published: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  archived: 'bg-zinc-200 text-zinc-600 ring-zinc-300',
};
const APP_STATUS_CLS: Record<ApplicationStatus, string> = {
  applied: 'bg-sky-50 text-sky-700 ring-sky-200',
  reviewing: 'bg-amber-50 text-amber-800 ring-amber-200',
  interview: 'bg-violet-50 text-violet-700 ring-violet-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function JobStatusPill({ status }: { status: JobStatus }) {
  const t = useTranslations('admin.jobStatus');
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${JOB_STATUS_CLS[status]}`}>{t(status)}</span>;
}

export function AppStatusPill({ status }: { status: ApplicationStatus }) {
  const t = useTranslations('status');
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ${APP_STATUS_CLS[status]}`}>{t(status)}</span>;
}

export function Card({ title, children, actions }: { title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-bold text-navy">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className = '' }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Right-hand pane placeholder of list/detail screens, so the page does not look half empty (xl screens only). */
export function EmptyPane({ text }: { text: string }) {
  return (
    <div className="hidden min-h-[16rem] place-items-center rounded-xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-500 xl:grid">
      <p>{text}</p>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="grid min-h-[30vh] place-items-center text-slate-400" role="status">
      <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const t = useTranslations('admin.common');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="mt-3 flex items-center justify-between gap-2 text-sm text-slate-600" aria-label="pagination">
      <span>{t('total', { total })}</span>
      <span className="flex items-center gap-1">
        <button type="button" className={btn.ghost} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('prev')}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <span className="min-w-[4rem] text-center tabular-nums">{t('pageOf', { page, pages })}</span>
        <button type="button" className={btn.ghost} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('next')}>
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </span>
    </nav>
  );
}

const LOCALE_LABEL: Record<string, string> = { ja: '日本語', en: 'EN', vi: 'VI', my: 'MY', ne: 'NE', bn: 'BN' };

/** One translatable field: a tab per language, a dot marks languages that have text. */
export function I18nField({
  label, value, onChange, multiline = false, required = false, hint, invalid = false,
}: {
  label: string; value: I18nText | null; onChange: (v: I18nText) => void;
  multiline?: boolean; required?: boolean; hint?: React.ReactNode; invalid?: boolean;
}) {
  const [loc, setLoc] = useState<string>('ja');
  const v = value ?? {};
  const set = (text: string) => {
    const next = { ...v, [loc]: text };
    if (!text) delete next[loc];
    onChange(next);
  };
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
        <span className="text-xs font-bold text-slate-600">{label}{required && ' *'}</span>
        <span className="flex flex-wrap gap-1" role="tablist" aria-label={label}>
          {ADMIN_LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={loc === l}
              onClick={() => setLoc(l)}
              className={`relative rounded-md px-2 py-1 text-xs font-bold ${loc === l ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {LOCALE_LABEL[l]}
              {v[l] && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" aria-hidden />}
            </button>
          ))}
        </span>
      </div>
      {multiline ? (
        <textarea
          lang={loc}
          rows={5}
          className={`${input} py-2 ${invalid ? 'border-red-400 ring-2 ring-red-200' : ''}`}
          value={v[loc] ?? ''}
          required={required && loc === 'ja'}
          onChange={(e) => set(e.target.value)}
          placeholder={loc !== 'ja' ? v.ja ?? '' : ''}
        />
      ) : (
        <input
          lang={loc}
          className={`${input} ${invalid ? 'border-red-400 ring-2 ring-red-200' : ''}`}
          value={v[loc] ?? ''}
          required={required && loc === 'ja'}
          onChange={(e) => set(e.target.value)}
          placeholder={loc !== 'ja' ? v.ja ?? '' : ''}
        />
      )}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Small accessible toggle switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

/** Translate an API error code: admin-specific first, then the shared `errors` namespace. */
export function useErrorText() {
  const te = useTranslations('errors');
  return (code: string | null) => (code ? (te.has(code) ? te(code) : te('generic')) : '');
}
