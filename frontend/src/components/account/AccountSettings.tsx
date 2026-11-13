'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BadgeCheck, ChevronLeft, KeyRound, Link2, Mail, ShieldAlert, Trash2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError, api, type Me } from '@/lib/api';
import { useSession } from '@/components/auth/SessionProvider';
import { Notice, PasswordInput, Submit, inputCls, useErrorText } from './ui';

type Msg = { kind: 'ok' | 'error'; text: string } | null;
const PROVIDERS = ['google', 'apple'] as const;
const PROVIDER_NAME = { google: 'Google', apple: 'Apple' } as const;

function Card({ icon, title, danger = false, children }: {
  icon: React.ReactNode; title: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border bg-white p-4 shadow-sm md:p-5 ${danger ? 'border-red-200' : 'border-slate-200'}`}>
      <h2 className={`mb-3 flex items-center gap-2 font-bold ${danger ? 'text-red-700' : 'text-navy'}`}>
        <span className={`grid h-8 w-8 place-items-center rounded-full ${danger ? 'bg-red-50' : 'bg-brand-light text-brand'}`} aria-hidden>
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Wraps a form submit: busy flag, API error -> translated message, success message. */
function useAction() {
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  async function run(fn: () => Promise<string | void>) {
    setBusy(true);
    setMsg(null);
    try {
      const ok = await fn();
      if (ok) setMsg({ kind: 'ok', text: ok });
    } catch (ex) {
      setMsg({ kind: 'error', text: errText(ex instanceof ApiError ? ex.code : 'network') });
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, setMsg, run };
}

function EmailCard({ me }: { me: Me }) {
  const t = useTranslations('account');
  const resend = useAction();
  const change = useAction();
  return (
    <Card icon={<Mail className="h-4 w-4" />} title={t('emailSection')}>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">{t('currentEmail')}</span>
        <span className="break-all font-medium text-slate-800">{me.email}</span>
        {me.email_verified ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
            {t('verified')}
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">{t('unverified')}</span>
        )}
      </p>
      {!me.email_verified && (
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            disabled={resend.busy}
            onClick={() => resend.run(async () => {
              await api('/auth/email/resend-verification', { method: 'POST' });
              return t('resent');
            })}
            className="min-h-[44px] justify-self-start rounded-xl border border-brand px-4 text-sm font-bold text-brand hover:bg-brand-light disabled:opacity-60"
          >
            {t('resend')}
          </button>
          {resend.msg && <Notice kind={resend.msg.kind}>{resend.msg.text}</Notice>}
        </div>
      )}

      <form
        className="mt-4 grid gap-3 border-t border-slate-100 pt-4"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          void change.run(async () => {
            const newEmail = String(f.get('new_email') ?? '');
            await api('/account/email', {
              method: 'POST', json: { new_email: newEmail, current_password: f.get('current_password') || null },
            });
            form.reset();
            return t('changeEmailSent', { email: newEmail });
          });
        }}
      >
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">{t('newEmail')}</span>
          <input name="new_email" type="email" required maxLength={320} autoComplete="email" inputMode="email" className={inputCls} />
        </label>
        {me.has_password && (
          <PasswordInput name="current_password" label={t('currentPassword')} autoComplete="current-password" minLength={1} />
        )}
        {change.msg && <Notice kind={change.msg.kind}>{change.msg.text}</Notice>}
        <div><Submit busy={change.busy}>{t('changeEmailSubmit')}</Submit></div>
      </form>
    </Card>
  );
}

function PasswordCard({ me }: { me: Me }) {
  const t = useTranslations('account');
  const ta = useTranslations('auth');
  const { reload } = useSession();
  const act = useAction();
  return (
    <Card icon={<KeyRound className="h-4 w-4" />} title={me.has_password ? t('passwordSection') : t('setPasswordSection')}>
      {!me.has_password && <p className="mb-3 text-sm text-slate-600">{t('setPasswordLead')}</p>}
      <form
        className="grid gap-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          if (f.get('new_password') !== f.get('confirm_password')) {
            act.setMsg({ kind: 'error', text: t('passwordMismatch') });
            return;
          }
          void act.run(async () => {
            await api('/account/password', {
              method: 'PUT',
              json: { current_password: f.get('current_password') || null, new_password: f.get('new_password') },
            });
            form.reset();
            await reload();
            return t('passwordChanged');
          });
        }}
      >
        {me.has_password && (
          <PasswordInput name="current_password" label={t('currentPassword')} autoComplete="current-password" minLength={1} />
        )}
        <PasswordInput name="new_password" label={t('newPassword')} autoComplete="new-password" hint={ta('passwordHint')} />
        <PasswordInput name="confirm_password" label={t('confirmPassword')} autoComplete="new-password" />
        {act.msg && <Notice kind={act.msg.kind}>{act.msg.text}</Notice>}
        <div><Submit busy={act.busy}>{t('changePasswordSubmit')}</Submit></div>
      </form>
    </Card>
  );
}

function LinkedCard({ me, linked, linkError }: { me: Me; linked?: string; linkError?: string }) {
  const t = useTranslations('account');
  const errText = useErrorText();
  const locale = useLocale();
  const { reload } = useSession();
  const act = useAction();
  const back = encodeURIComponent(`/${locale}/mypage/account`);
  const initial: Msg = linked && linked in PROVIDER_NAME
    ? { kind: 'ok', text: t('linkedDone', { provider: PROVIDER_NAME[linked as keyof typeof PROVIDER_NAME] }) }
    : linkError ? { kind: 'error', text: errText(linkError) } : null;
  const msg = act.msg ?? initial;

  return (
    <Card icon={<Link2 className="h-4 w-4" />} title={t('linkedSection')}>
      <p className="mb-3 text-sm text-slate-600">{t('linkedLead')}</p>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {PROVIDERS.map((p) => {
          const isLinked = me.providers.includes(p);
          return (
            <li key={p} className="flex min-h-[56px] items-center justify-between gap-3 px-3">
              <span className="font-medium text-slate-800">
                {PROVIDER_NAME[p]}
                {isLinked && <BadgeCheck className="ml-1 inline h-4 w-4 text-emerald-600" aria-label={t('verified')} />}
              </span>
              {isLinked ? (
                <button
                  type="button"
                  disabled={act.busy}
                  onClick={() => act.run(async () => {
                    await api(`/account/social/${p}`, { method: 'DELETE' });
                    await reload();
                    return t('unlinkedDone', { provider: PROVIDER_NAME[p] });
                  })}
                  className="min-h-[40px] rounded-lg px-3 text-sm font-medium text-slate-600 underline hover:bg-slate-50 disabled:opacity-60"
                >
                  {t('unlink')}
                </button>
              ) : (
                // full-page navigation: the backend runs the OIDC redirect flow and comes back here
                <a
                  href={`/api/v1/auth/oauth/${p}/login?link=1&next=${back}`}
                  className="min-h-[40px] rounded-lg border border-brand px-3 py-2 text-sm font-bold text-brand hover:bg-brand-light"
                >
                  {t('link')}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
    </Card>
  );
}

function DeleteCard({ me }: { me: Me }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const act = useAction();
  const [agree, setAgree] = useState(false);
  return (
    <Card icon={<Trash2 className="h-4 w-4" />} title={t('deleteSection')} danger>
      <Notice kind="info">{t('deleteLead')}</Notice>
      <form
        className="mt-3 grid gap-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void act.run(async () => {
            await api('/account/delete', {
              method: 'POST',
              json: me.has_password ? { password: f.get('password') } : { confirm_email: f.get('confirm_email') },
            });
            window.location.replace(`/${locale}/account-deleted`); // full reload: no stale session in memory
          });
        }}
      >
        {me.has_password ? (
          <PasswordInput name="password" label={t('currentPassword')} autoComplete="current-password" minLength={1} />
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{t('deleteConfirmEmail')}</span>
            <input name="confirm_email" type="email" required maxLength={320} autoComplete="off" className={inputCls} />
          </label>
        )}
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-5 w-5 accent-red-600" />
          {t('deleteAgree')}
        </label>
        {act.msg && <Notice kind={act.msg.kind}>{act.msg.text}</Notice>}
        <div><Submit busy={act.busy} disabled={!agree} danger>{t('deleteSubmit')}</Submit></div>
      </form>
    </Card>
  );
}

export default function AccountSettings({ linked, linkError }: { linked?: string; linkError?: string }) {
  const t = useTranslations('account');
  const tm = useTranslations('mypage');
  const { user } = useSession();
  if (!user) return null; // RequireAuth renders us only with a user

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/mypage" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-slate-600 hover:text-brand">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {tm('title')}
      </Link>
      <h1 className="flex items-center gap-2 text-2xl font-bold text-navy">
        <ShieldAlert className="h-6 w-6 text-brand" aria-hidden />
        {t('title')}
      </h1>
      <EmailCard me={user} />
      <PasswordCard me={user} />
      <LinkedCard me={user} linked={linked} linkError={linkError} />
      {user.role === 'candidate' && <DeleteCard me={user} />}
    </div>
  );
}
