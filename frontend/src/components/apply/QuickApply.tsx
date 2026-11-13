'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, FileText, Loader2, Send, X, Zap } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError, api, type MyApplication, type Resume } from '@/lib/api';
import { useSession } from '@/components/auth/SessionProvider';
import ResumeUploader from '@/components/mypage/ResumeUploader';

type Props = { jobId: string; jobCode: string };

const cta =
  'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full px-6 text-base font-bold md:mx-auto md:flex md:w-auto md:min-w-[320px]';

/** "Quick Apply": pick a saved CV (or upload one right here), add an optional note, send. Bottom sheet on phones. */
export default function QuickApply({ jobId, jobCode }: Props) {
  const t = useTranslations('apply');
  const te = useTranslations('errors');
  const locale = useLocale();
  const { user, loading } = useSession();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [applied, setApplied] = useState(false);
  const [open, setOpen] = useState(false);
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [choice, setChoice] = useState<string>(''); // '' = apply without CV
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<'form' | 'sending' | 'done'>('form');
  const [err, setErr] = useState<string | null>(null);

  const isCandidate = user?.role === 'candidate';

  // Already applied? (one lightweight call, only for logged-in candidates)
  useEffect(() => {
    if (!isCandidate) return;
    api<MyApplication[]>('/applications/my-applications')
      .then((list) => setApplied(list.some((a) => a.job.id === jobId)))
      .catch(() => undefined);
  }, [isCandidate, jobId]);

  // Open: load CVs, preselect the default one, lock page scroll, focus the dialog; Escape closes.
  useEffect(() => {
    if (!open) return;
    api<Resume[]>('/resumes')
      .then((rs) => {
        setResumes(rs);
        setChoice(rs.find((r) => r.is_default)?.id ?? '');
      })
      .catch(() => setResumes([]));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const trigger = triggerRef.current;
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [open]);

  async function submit() {
    setPhase('sending');
    setErr(null);
    try {
      await api('/applications', {
        method: 'POST',
        json: { job_id: jobId, resume_id: choice || null, cover_message: message.trim() || null },
      });
      setPhase('done');
      setApplied(true);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'generic';
      if (code === 'already_applied') setApplied(true);
      setErr(code);
      setPhase('form');
    }
  }

  /* ---------- trigger states ---------- */
  if (loading) {
    return <button type="button" disabled className={`${cta} bg-slate-200 text-slate-500`}><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{t('cta')}</button>;
  }
  if (!user) {
    return (
      <Link href={{ pathname: '/login', query: { next: `/${locale}/jobs/${jobCode}` } }} className={`${cta} bg-brand text-white hover:bg-brand-dark`}>
        <Zap className="h-5 w-5" aria-hidden />
        {t('loginToApply')}
      </Link>
    );
  }
  if (!isCandidate) {
    return <p className="text-center text-sm text-slate-600">{t('staffNote')}</p>;
  }
  if (applied && !open) {
    return (
      <Link href="/mypage" className={`${cta} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`}>
        <CheckCircle2 className="h-5 w-5" aria-hidden />
        {t('applied')}
      </Link>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setPhase('form');
          setErr(null);
          setOpen(true);
        }}
        className={`${cta} bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-dark`}
      >
        <Zap className="h-5 w-5" aria-hidden />
        {t('cta')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 md:items-center" onClick={() => setOpen(false)}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none motion-safe:animate-[sheet_250ms_ease-out] md:max-w-lg md:rounded-3xl"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200 md:hidden" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-lg font-bold text-navy">{phase === 'done' ? t('success') : t('title')}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('close')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-slate-100">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            {phase === 'done' ? (
              <div className="py-6 text-center">
                <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500 motion-safe:animate-[pop_400ms_ease-out]" aria-hidden />
                <p className="mt-3 text-slate-600">{t('successText')}</p>
                <Link href="/mypage" className="mt-5 inline-flex min-h-[48px] items-center rounded-full bg-navy px-6 font-bold text-white">
                  {t('toMypage')}
                </Link>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-bold text-slate-700">{t('chooseResume')}</legend>
                  {resumes === null ? (
                    <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                  ) : (
                    <div className="space-y-2">
                      {resumes.map((r) => (
                        <label key={r.id} className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border p-3 ${choice === r.id ? 'border-brand bg-brand-light' : 'border-slate-200'}`}>
                          <input type="radio" name="resume" value={r.id} checked={choice === r.id} onChange={() => setChoice(r.id)} className="h-4 w-4 accent-brand" />
                          <FileText className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
                          <span className="min-w-0 flex-1 truncate text-sm">{r.original_filename}</span>
                        </label>
                      ))}
                      <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border p-3 ${choice === '' ? 'border-brand bg-brand-light' : 'border-slate-200'}`}>
                        <input type="radio" name="resume" value="" checked={choice === ''} onChange={() => setChoice('')} className="h-4 w-4 accent-brand" />
                        <span className="text-sm text-slate-600">{t('noResume')}</span>
                      </label>
                    </div>
                  )}
                </fieldset>

                {resumes !== null && resumes.length < 5 && (
                  <div>
                    <p className="mb-2 text-sm font-bold text-slate-700">{t('uploadNew')}</p>
                    <ResumeUploader
                      compact
                      onUploaded={(r) => {
                        setResumes((prev) => [r, ...(prev ?? [])]);
                        setChoice(r.id);
                      }}
                    />
                  </div>
                )}

                <label className="block">
                  <span className="mb-1 block text-sm font-bold text-slate-700">{t('message')}</span>
                  <textarea
                    rows={3}
                    maxLength={3000}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('messagePlaceholder')}
                    className="w-full rounded-xl border border-slate-200 p-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </label>

                {err && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      {te.has(err) ? te(err) : te('generic')}
                      {(err === 'profile_incomplete' || err === 'profile_required') && (
                        <Link href="/mypage/profile" className="ml-1 font-bold underline">{t('toProfile')}</Link>
                      )}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={phase === 'sending' || resumes === null}
                  className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand px-6 text-base font-bold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {phase === 'sending' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Send className="h-5 w-5" aria-hidden />}
                  {phase === 'sending' ? t('submitting') : t('submit')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
