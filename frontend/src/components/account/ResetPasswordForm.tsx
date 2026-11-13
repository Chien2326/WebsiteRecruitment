'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/components/auth/SessionProvider';
import { AuthCard, Notice, PasswordInput, Submit, scrubTokenFromUrl, useErrorText } from './ui';

export default function ResetPasswordForm({ token }: { token: string | undefined }) {
  const t = useTranslations('account');
  const ta = useTranslations('auth');
  const errText = useErrorText();
  const { reload } = useSession();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(token ? null : 'invalid_token');

  useEffect(scrubTokenFromUrl, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('new_password') !== f.get('confirm_password')) return setErr('password_mismatch');
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/password/reset', { method: 'POST', json: { token, new_password: f.get('new_password') } });
      setDone(true);
      await reload(); // every session was revoked, including this browser's
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'network');
    } finally {
      setBusy(false);
    }
  }

  const invalid = err === 'invalid_token';
  return (
    <AuthCard title={t('resetTitle')} lead={done || invalid ? undefined : t('resetLead')}>
      {done ? (
        <div className="grid gap-4">
          <Notice kind="ok">{t('resetDone')}</Notice>
          <Link href="/login" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-brand font-bold text-white">
            {ta('submitLogin')}
          </Link>
        </div>
      ) : invalid ? (
        <div className="grid gap-4">
          <Notice kind="error">{t('invalidLink')}</Notice>
          <Link href="/forgot-password" className="text-center font-bold text-brand underline">{t('requestNewLink')}</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3">
          {err && <Notice kind="error">{err === 'password_mismatch' ? t('passwordMismatch') : errText(err)}</Notice>}
          <PasswordInput name="new_password" label={t('newPassword')} autoComplete="new-password" hint={ta('passwordHint')} />
          <PasswordInput name="confirm_password" label={t('confirmPassword')} autoComplete="new-password" />
          <Submit busy={busy}>{t('resetSubmit')}</Submit>
        </form>
      )}
    </AuthCard>
  );
}
