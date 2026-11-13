'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';

export const inputCls =
  'min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';

/** Narrow centred card used by the logged-out flows (forgot / reset / verify). */
export function AuthCard({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {lead && <p className="mt-1 text-sm text-slate-600">{lead}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-emerald-50 text-emerald-800',
    error: 'bg-red-50 text-red-700',
    info: 'bg-amber-50 text-amber-900',
  }[kind];
  const Icon = kind === 'ok' ? CheckCircle2 : AlertCircle;
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl p-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** Translated API error code, with a generic fallback for unknown codes. */
export function useErrorText(): (code: string) => string {
  const te = useTranslations('errors');
  return (code) => (te.has(code) ? te(code) : te('generic'));
}

export function PasswordInput({
  name, label, autoComplete, minLength = 10, hint,
}: { name: string; label: string; autoComplete: string; minLength?: number; hint?: string }) {
  const t = useTranslations('auth');
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-slate-700">
        {label}
        {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
      </span>
      <span className="relative block">
        <input
          name={name}
          type={show ? 'text' : 'password'}
          required
          minLength={minLength}
          maxLength={128}
          autoComplete={autoComplete}
          className={`${inputCls} pr-12`}
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? t('hidePassword') : t('showPassword')}
          className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
        >
          {show ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
        </button>
      </span>
    </label>
  );
}

export function Submit({ busy, children, danger = false, disabled = false }: {
  busy: boolean; children: React.ReactNode; danger?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-6 font-bold text-white disabled:opacity-60 ${
        danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-dark'
      }`}
    >
      {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Remove a one-time token from the address bar (history, screenshots, shoulder surfing). */
export function scrubTokenFromUrl(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has('token')) {
    url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
}
