'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiError, api } from '@/lib/api';
import { AuthCard, Notice, Submit, inputCls, useErrorText } from './ui';

export default function ForgotPasswordForm() {
  const t = useTranslations('account');
  const ta = useTranslations('auth');
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = new FormData(e.currentTarget).get('email');
    setBusy(true);
    setErr(null);
    try {
      await api('/auth/password/forgot', { method: 'POST', json: { email } });
      setSent(true); // same message whether or not the address is registered
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('forgotTitle')} lead={sent ? undefined : t('forgotLead')}>
      {sent ? (
        <Notice kind="ok">{t('forgotSent')}</Notice>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-3">
          {err && <Notice kind="error">{errText(err)}</Notice>}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{ta('email')}</span>
            <input name="email" type="email" required maxLength={320} autoComplete="email" inputMode="email" className={inputCls} />
          </label>
          <Submit busy={busy}>{t('forgotSubmit')}</Submit>
        </form>
      )}
      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="font-bold text-brand underline">{t('backToLogin')}</Link>
      </p>
    </AuthCard>
  );
}
