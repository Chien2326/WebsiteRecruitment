'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter as useNextRouter } from 'next/navigation';
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError, api, safeNext } from '@/lib/api';
import { useSession } from './SessionProvider';

type Props = { mode: 'login' | 'signup'; next?: string; error?: string };

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M16.37 12.6c-.02-2.1 1.72-3.12 1.8-3.17-0.98-1.43-2.5-1.63-3.04-1.65-1.29-.13-2.52.76-3.18.76-.66 0-1.67-.74-2.75-.72-1.41.02-2.72.82-3.45 2.09-1.47 2.55-.38 6.33 1.06 8.4.7 1.01 1.53 2.15 2.62 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.05.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.85-2.22-3.36zM14.3 6.43c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.54.62-1.01 1.61-.88 2.56.93.07 1.88-.47 2.46-1.16z" />
    </svg>
  );
}

export default function AuthForm({ mode, next, error }: Props) {
  const t = useTranslations('auth');
  const te = useTranslations('errors');
  const locale = useLocale();
  const nav = useNextRouter();
  const { reload } = useSession();
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(error ?? null);

  const target = safeNext(next, `/${locale}/mypage`);
  const oauthHref = (p: 'google' | 'apple') => `/api/v1/auth/oauth/${p}/login?next=${encodeURIComponent(target)}`;
  const errText = (code: string) => (te.has(code) ? te(code) : te('generic'));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body =
      mode === 'signup'
        ? {
            email: f.get('email'), password: f.get('password'), preferred_locale: locale,
            last_name: f.get('last_name'), first_name: f.get('first_name'),
          }
        : { email: f.get('email'), password: f.get('password') };
    setBusy(true);
    setErr(null);
    try {
      await api(mode === 'signup' ? '/auth/register' : '/auth/login', { method: 'POST', json: body });
      await reload();
      nav.replace(target);
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'network');
      setBusy(false);
    }
  }

  const input =
    'min-h-[48px] w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
  const icon = 'pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400';

  return (
    <div className="mx-auto max-w-md">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-2xl font-bold text-navy">{mode === 'signup' ? t('signupTitle') : t('loginTitle')}</h1>
        <p className="mt-1 text-sm text-slate-600">{mode === 'signup' ? t('signupLead') : t('loginLead')}</p>

        {err && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {errText(err)}
          </p>
        )}

        {/* Social sign-in: full-page navigation to the backend (OIDC redirect flow) */}
        <div className="mt-5 grid gap-2">
          <a
            href={oauthHref('google')}
            className="flex min-h-[48px] items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-4 font-medium text-slate-800 hover:bg-slate-50"
          >
            <GoogleLogo />
            {t('google')}
          </a>
          <a
            href={oauthHref('apple')}
            className="flex min-h-[48px] items-center justify-center gap-3 rounded-xl bg-black px-4 font-medium text-white hover:bg-slate-800"
          >
            <AppleLogo />
            {t('apple')}
          </a>
        </div>

        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          {t('or')}
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={onSubmit} className="grid gap-3" noValidate={false}>
          {mode === 'signup' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="relative block">
                <span className="mb-1 block text-sm font-medium text-slate-700">{t('lastName')}</span>
                <span className="relative block">
                  <UserRound className={icon} aria-hidden />
                  <input name="last_name" required maxLength={100} autoComplete="family-name" className={input} />
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">{t('firstName')}</span>
                <input name="first_name" required maxLength={100} autoComplete="given-name" className={`${input} pl-3`} />
              </label>
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{t('email')}</span>
            <span className="relative block">
              <Mail className={icon} aria-hidden />
              <input name="email" type="email" required maxLength={320} autoComplete="email" inputMode="email" className={input} />
            </span>
          </label>
          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-sm font-medium text-slate-700">
              {t('password')}
              {mode === 'signup' && <span className="text-xs font-normal text-slate-500">{t('passwordHint')}</span>}
            </span>
            <span className="relative block">
              <Lock className={icon} aria-hidden />
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                required
                minLength={mode === 'signup' ? 10 : 1}
                maxLength={128}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className={`${input} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t('hidePassword') : t('showPassword')}
                className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                {showPw ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
              </button>
            </span>
          </label>
          {mode === 'login' && (
            <Link href="/forgot-password" className="justify-self-end text-sm font-medium text-brand underline">
              {t('forgotPassword')}
            </Link>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-2 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-bold text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
            {mode === 'signup' ? t('submitSignup') : t('submitLogin')}
          </button>
          {mode === 'signup' && <p className="text-xs text-slate-500">{t('agree')}</p>}
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-slate-600">
        {mode === 'signup' ? t('haveAccount') : t('noAccount')}{' '}
        <Link
          href={{ pathname: mode === 'signup' ? '/login' : '/signup', query: next ? { next } : {} }}
          className="font-bold text-brand underline"
        >
          {mode === 'signup' ? t('toLogin') : t('toSignup')}
        </Link>
      </p>
    </div>
  );
}
