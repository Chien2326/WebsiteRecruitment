'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MailWarning } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { useErrorText } from './ui';

/** Shown on My page until the email address is confirmed. */
export default function VerifyBanner() {
  const t = useTranslations('account');
  const errText = useErrorText();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function resend() {
    setState('busy');
    setErr(null);
    try {
      await api('/auth/email/resend-verification', { method: 'POST' });
      setState('sent');
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'network');
      setState('idle');
    }
  }

  return (
    <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center">
      <MailWarning className="h-6 w-6 shrink-0 text-amber-700" aria-hidden />
      <p className="flex-1 text-sm text-amber-900">
        {state === 'sent' ? t('resent') : t('bannerUnverified')}
        {err && <span className="mt-1 block text-red-700">{errText(err)}</span>}
      </p>
      {state !== 'sent' && (
        <button
          type="button"
          onClick={resend}
          disabled={state === 'busy'}
          className="min-h-[44px] shrink-0 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {t('resend')}
        </button>
      )}
    </div>
  );
}
