'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError, api } from '@/lib/api';
import { useSession } from '@/components/auth/SessionProvider';
import { AuthCard, Notice, scrubTokenFromUrl, useErrorText } from './ui';

type Result = { purpose: 'verify_email' | 'change_email'; email: string };

/** Landing page of the emailed link: confirms the address (sign-up) or completes an email change. */
export default function VerifyEmail({ token }: { token: string | undefined }) {
  const t = useTranslations('account');
  const errText = useErrorText();
  const { user, reload } = useSession();
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(token ? null : 'invalid_token');
  const started = useRef(false);

  useEffect(() => {
    scrubTokenFromUrl();
    if (!token || started.current) return; // StrictMode runs effects twice; the token is single-use
    started.current = true;
    api<Result>('/auth/email/confirm', { method: 'POST', json: { token } })
      .then(async (r) => {
        setResult(r);
        await reload(); // refresh "verified" badge / new email if this browser is logged in
      })
      .catch((ex) => setErr(ex instanceof ApiError ? ex.code : 'network'));
  }, [token, reload]);

  return (
    <AuthCard title={t('verifyTitle')}>
      {result ? (
        <div className="grid gap-4">
          <Notice kind="ok">
            {result.purpose === 'change_email' ? t('emailChangedDone', { email: result.email }) : t('verifiedDone')}
          </Notice>
          <Link
            href={user ? '/mypage' : '/login'}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-brand font-bold text-white"
          >
            {t('toMypage')}
          </Link>
        </div>
      ) : err ? (
        <div className="grid gap-4">
          <Notice kind="error">{err === 'invalid_token' ? t('invalidLink') : errText(err)}</Notice>
          <Link href={user ? '/mypage/account' : '/login'} className="text-center font-bold text-brand underline">
            {t('toMypage')}
          </Link>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-slate-600" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          {t('verifying')}
        </p>
      )}
    </AuthCard>
  );
}
