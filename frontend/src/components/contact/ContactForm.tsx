'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { Notice, Submit, inputCls, useErrorText } from '@/components/account/ui';

/** POST /api/v1/contact: lands in the same admin inbox as the employer form (kind = general). */
export default function ContactForm() {
  const t = useTranslations('contactPage.form');
  const locale = useLocale();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const str = (k: string) => String(fd.get(k) ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      await api('/contact', {
        method: 'POST',
        json: { name: str('name'), email: str('email'), message: str('message'), locale, website: str('website'), agree: fd.get('agree') === 'on' },
      });
      setDone(true);
    } catch (err) {
      setError(errText(err instanceof ApiError ? err.code : 'network'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-bold text-emerald-800">{t('doneTitle')}</p>
        <p className="mt-2 text-sm text-emerald-900">{t('doneBody')}</p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="relative space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">{t('name')}</span>
          <input name="name" required maxLength={100} autoComplete="name" className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-bold text-slate-700">{t('email')}</span>
          <input name="email" type="email" required maxLength={320} autoComplete="email" className={inputCls} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-bold text-slate-700">{t('message')}</span>
        <textarea name="message" required maxLength={2000} rows={6} className={`${inputCls} py-2`} />
        <span className="mt-1 block text-xs text-slate-500">{t('messageHint')}</span>
      </label>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="agree" required className="mt-1 h-5 w-5 shrink-0 accent-brand" />
        <span>
          {t.rich('agree', { link: (chunks) => <Link href="/privacy" target="_blank" className="font-bold text-navy underline">{chunks}</Link> })}
        </span>
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <Submit busy={busy}>
        <Send className="h-4 w-4" aria-hidden />
        {t('submit')}
      </Submit>
    </form>
  );
}
