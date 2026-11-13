'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { PREFECTURES, prefectureName } from '@/lib/japan';
import { Link } from '@/i18n/navigation';
import { Notice, Submit, inputCls, useErrorText } from '@/components/account/ui';

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  const t = useTranslations('employersPage.form');
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-700">
        {label}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${required ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500'}`}>
          {required ? t('required') : t('optional')}
        </span>
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** POST /api/v1/employers/inquiries. Anonymous; CSRF double-submit like every other form; rate-limited server side. */
export default function InquiryForm() {
  const t = useTranslations('employersPage.form');
  const locale = useLocale();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const str = (k: string) => String(fd.get(k) ?? '').trim();
    const num = (k: string) => (str(k) ? Number(str(k)) : null);
    setBusy(true);
    setError(null);
    try {
      await api('/employers/inquiries', {
        method: 'POST',
        json: {
          company_name: str('company_name'),
          contact_name: str('contact_name'),
          email: str('email'),
          phone: str('phone') || null,
          prefecture_id: num('prefecture_id'),
          headcount: num('headcount'),
          message: str('message'),
          locale,
          website: str('website'),
          agree: fd.get('agree') === 'on',
        },
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
        <Field label={t('company')} required>
          <input name="company_name" required maxLength={200} autoComplete="organization" className={inputCls} />
        </Field>
        <Field label={t('contact')} required>
          <input name="contact_name" required maxLength={100} autoComplete="name" className={inputCls} />
        </Field>
        <Field label={t('email')} required>
          <input name="email" type="email" required maxLength={320} autoComplete="email" className={inputCls} />
        </Field>
        <Field label={t('phone')}>
          <input name="phone" type="tel" maxLength={30} pattern="[0-9+()\- ]*" autoComplete="tel" className={inputCls} placeholder="03-1234-5678" />
        </Field>
        <Field label={t('prefecture')}>
          <select name="prefecture_id" defaultValue="" className={inputCls}>
            <option value="">{t('prefectureAny')}</option>
            {PREFECTURES.map((p) => <option key={p.id} value={p.id}>{prefectureName(p, locale)}</option>)}
          </select>
        </Field>
        <Field label={t('headcount')}>
          <input name="headcount" type="number" min={1} max={100000} inputMode="numeric" className={inputCls} />
        </Field>
      </div>
      <Field label={t('message')} required hint={t('messageHint')}>
        <textarea name="message" required maxLength={2000} rows={6} className={`${inputCls} py-2`} />
      </Field>

      {/* Honeypot: hidden from people and screen readers; bots that fill every field get a silent no-op. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="agree" required className="mt-1 h-5 w-5 shrink-0 accent-brand" />
        <span>{t.rich('agree', { link: (chunks) => <Link href="/privacy" target="_blank" className="font-bold text-navy underline">{chunks}</Link> })}</span>
      </label>

      {error && <Notice kind="error">{error}</Notice>}
      <Submit busy={busy}>
        <Send className="h-4 w-4" aria-hidden />
        {t('submit')}
      </Submit>
    </form>
  );
}
