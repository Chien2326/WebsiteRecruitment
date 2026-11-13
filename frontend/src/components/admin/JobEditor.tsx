'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeft, Check, EyeOff, Lock, Loader2, MessageSquareWarning, Send, Undo2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSession } from '@/components/auth/SessionProvider';
import { ApiError, api, type JapaneseLevel, type VisaType } from '@/lib/api';
import { FEATURES, can, displayRevealsClient, type AdminJob, type JobStatus } from '@/lib/admin';
import { PREFECTURES, prefectureName } from '@/lib/japan';
import { localize, type I18nText } from '@/lib/job';
import { Card, Field, I18nField, JobStatusPill, Spinner, btn, input, useErrorText } from './ui';

type Form = Omit<AdminJob, 'id' | 'job_code' | 'status' | 'review_note' | 'published_at' | 'created_by'> & {
  end_client_name: string;
};

const EMPTY: Form = {
  title: {}, description: {}, client_display_name: null, employment_type: 'haken', salary_type: 'hourly',
  salary_min: 1200, salary_max: null, transport_fee_included: false, prefecture_id: 13, city: null, nearest_station: null,
  work_shift: null, work_hours_per_week: null, japanese_level_required: 'none', features: [], visa_type_ids: [],
  expires_at: null, end_client_name: '', end_client_address: null, internal_note: null,
};
const LEVELS: JapaneseLevel[] = ['none', 'n5', 'n4', 'n3', 'n2', 'n1'];

export default function JobEditor({ jobId }: { jobId?: string }) {
  const t = useTranslations('admin');
  const tj = useTranslations('jobDetail');
  const errText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const { user } = useSession();
  const [job, setJob] = useState<AdminJob | null>(null);
  const [form, setForm] = useState<Form | null>(jobId ? null : EMPTY);
  const [visas, setVisas] = useState<VisaType[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/visa-types').then((r) => r.json()).then(setVisas).catch(() => undefined);
    if (!jobId) return;
    api<AdminJob>(`/admin/jobs/${jobId}`)
      .then((j) => {
        setJob(j);
        setForm({ ...EMPTY, ...j, end_client_name: j.end_client_name ?? '' });
      })
      .catch((e) => setErr(e instanceof ApiError ? e.code : 'generic'));
  }, [jobId]);

  const leak = useMemo(() => !!form && displayRevealsClient(form.client_display_name, form.end_client_name), [form]);
  const approver = can(user, 'jobs.approve');
  const isOwner = !!job && job.created_by === user?.id;

  if (!form) return err ? <p role="alert" className="text-red-700">{errText(err)}</p> : <Spinner />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((p) => (p ? { ...p, [k]: v } : p));
  const toggleIn = (k: 'features' | 'visa_type_ids', v: string | number) =>
    set(k, ((form[k] as (string | number)[]).includes(v) ? (form[k] as (string | number)[]).filter((x) => x !== v) : [...(form[k] as (string | number)[]), v]) as never);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (!form) return;
    setBusy(true);
    setErr(null);
    const body = {
      ...form,
      salary_max: form.salary_max || null,
      work_hours_per_week: form.work_hours_per_week || null,
      client_display_name: form.client_display_name && Object.keys(form.client_display_name).length ? form.client_display_name : null,
      end_client_address: form.end_client_address || null,
      internal_note: form.internal_note || null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };
    try {
      const saved = await api<AdminJob>(jobId ? `/admin/jobs/${jobId}` : '/admin/jobs', { method: jobId ? 'PUT' : 'POST', json: body });
      if (!jobId) {
        router.replace(`/admin/jobs/${saved.id}`);
        return;
      }
      setJob(saved);
      setFlash(t('common.saved'));
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'generic');
    } finally {
      setBusy(false);
    }
  }

  async function transition(to: JobStatus, askNote = false) {
    let note: string | null = null;
    if (askNote) {
      note = window.prompt(t('editor.rejectPrompt'));
      if (note === null) return;
    }
    setBusy(true);
    setErr(null);
    try {
      const j = await api<AdminJob>(`/admin/jobs/${jobId}/transition`, { method: 'POST', json: { to, note } });
      setJob(j);
      setFlash(t(`jobStatus.${j.status}`));
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'generic');
    } finally {
      setBusy(false);
    }
  }

  // Workflow buttons depend on status + permission (the API enforces the same table).
  const s = job?.status;
  const actions: { label: string; to: JobStatus; icon: typeof Send; style: string; note?: boolean }[] = [];
  if (job) {
    if (s === 'draft') actions.push({ label: t('editor.submit'), to: 'pending', icon: Send, style: btn.primary });
    if (s === 'pending' && approver) {
      actions.push({ label: t('editor.publish'), to: 'published', icon: Check, style: btn.brand });
      if (!isOwner) actions.push({ label: t('editor.reject'), to: 'draft', icon: MessageSquareWarning, style: btn.ghost, note: true });
    }
    if (s === 'pending' && (isOwner || !approver)) actions.push({ label: t('editor.withdraw'), to: 'draft', icon: Undo2, style: btn.ghost });
    if (s === 'draft' && approver) actions.push({ label: t('editor.publish'), to: 'published', icon: Check, style: btn.brand });
    if (s === 'published') actions.push({ label: t('editor.hide'), to: 'archived', icon: EyeOff, style: btn.danger });
    if (s === 'archived' && approver) {
      actions.push({ label: t('editor.reopen'), to: 'published', icon: Check, style: btn.brand });
      actions.push({ label: t('editor.toDraft'), to: 'draft', icon: Undo2, style: btn.ghost });
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/admin/jobs" className="inline-flex items-center gap-1 text-sm text-navy hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden />{t('editor.back')}
          </Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-navy">
            {job ? localize(job.title, locale) || job.job_code : t('editor.titleNew')}
            {job && <JobStatusPill status={job.status} />}
          </h1>
          {job && <p className="font-mono text-xs text-slate-500">{job.job_code}</p>}
        </div>
      </div>

      {job?.review_note && job.status === 'draft' && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span><b>{t('editor.reviewNote')}:</b> {job.review_note}</span>
        </p>
      )}

      <Card title={t('editor.sectionContent')}>
        <div className="space-y-4">
          <I18nField label={t('editor.title')} value={form.title} onChange={(v) => set('title', v)} required />
          <I18nField label={t('editor.description')} value={form.description} onChange={(v) => set('description', v)} multiline required />
        </div>
      </Card>

      <Card title={t('editor.sectionCompany')}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-dashed border-red-200 bg-red-50/40 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-red-700">
              <Lock className="h-3.5 w-3.5" aria-hidden />{t('editor.endClientHint')}
            </p>
            <Field label={`${t('editor.endClient')} *`}>
              <input className={input} required maxLength={255} value={form.end_client_name} onChange={(e) => set('end_client_name', e.target.value)} />
            </Field>
            <Field label={t('editor.endClientAddress')}>
              <input className={input} maxLength={500} value={form.end_client_address ?? ''} onChange={(e) => set('end_client_address', e.target.value)} />
            </Field>
            <Field label={t('editor.internalNote')}>
              <textarea rows={2} className={`${input} py-2`} value={form.internal_note ?? ''} onChange={(e) => set('internal_note', e.target.value)} />
            </Field>
          </div>
          <div>
            <I18nField
              label={t('editor.displayName')}
              value={form.client_display_name}
              onChange={(v) => set('client_display_name', v as I18nText)}
              hint={t('editor.displayNameHint')}
              invalid={leak}
            />
            {leak && (
              <p role="alert" className="mt-2 flex items-center gap-1.5 text-sm font-bold text-red-700">
                <AlertTriangle className="h-4 w-4" aria-hidden />{t('editor.displayLeak')}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('editor.sectionConditions')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('editor.employmentType')}>
            <select className={input} value={form.employment_type} onChange={(e) => set('employment_type', e.target.value as Form['employment_type'])}>
              {(['haken', 'part_time', 'full_time', 'contract'] as const).map((v) => <option key={v} value={v}>{tj(`employment.${v}`)}</option>)}
            </select>
          </Field>
          <Field label={t('editor.salaryType')}>
            <select className={input} value={form.salary_type} onChange={(e) => set('salary_type', e.target.value as Form['salary_type'])}>
              <option value="hourly">{t('editor.hourly')}</option>
              <option value="monthly">{t('editor.monthly')}</option>
            </select>
          </Field>
          <Field label={`${t('editor.salaryMin')} *`}>
            <input type="number" min={1} required className={input} value={form.salary_min} onChange={(e) => set('salary_min', Number(e.target.value))} />
          </Field>
          <Field label={t('editor.salaryMax')}>
            <input type="number" min={1} className={input} value={form.salary_max ?? ''} onChange={(e) => set('salary_max', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label={`${t('editor.prefecture')} *`}>
            <select className={input} value={form.prefecture_id} onChange={(e) => set('prefecture_id', Number(e.target.value))}>
              {PREFECTURES.map((p) => <option key={p.id} value={p.id}>{prefectureName(p, locale)}</option>)}
            </select>
          </Field>
          <Field label={t('editor.level')}>
            <select className={input} value={form.japanese_level_required} onChange={(e) => set('japanese_level_required', e.target.value as JapaneseLevel)}>
              {LEVELS.map((l) => <option key={l} value={l}>{tj(`level.${l}`)}</option>)}
            </select>
          </Field>
          <Field label={t('editor.hoursPerWeek')}>
            <input type="number" min={1} max={80} className={input} value={form.work_hours_per_week ?? ''} onChange={(e) => set('work_hours_per_week', e.target.value ? Number(e.target.value) : null)} />
          </Field>
          <Field label={t('editor.expires')}>
            <input type="date" className={input} value={form.expires_at ? form.expires_at.slice(0, 10) : ''} onChange={(e) => set('expires_at', e.target.value || null)} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="h-4 w-4 accent-navy" checked={form.transport_fee_included} onChange={(e) => set('transport_fee_included', e.target.checked)} />
            {t('editor.transport')}
          </label>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="mb-1 text-xs font-bold text-slate-600">{t('editor.visas')}</legend>
            <div className="flex flex-wrap gap-2">
              {visas.map((v) => (
                <label key={v.id} className={`cursor-pointer rounded-full px-3 py-1 text-xs ring-1 ${form.visa_type_ids.includes(v.id) ? 'bg-navy text-white ring-navy' : 'bg-white text-slate-700 ring-slate-300'}`}>
                  <input type="checkbox" className="sr-only" checked={form.visa_type_ids.includes(v.id)} onChange={() => toggleIn('visa_type_ids', v.id)} />
                  {localize(v.name, locale)}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-xs font-bold text-slate-600">{t('editor.features')}</legend>
            <div className="flex flex-wrap gap-2">
              {FEATURES.map((k) => (
                <label key={k} className={`cursor-pointer rounded-full px-3 py-1 text-xs ring-1 ${form.features.includes(k) ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-700 ring-slate-300'}`}>
                  <input type="checkbox" className="sr-only" checked={form.features.includes(k)} onChange={() => toggleIn('features', k)} />
                  {tj(`feature.${k}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <I18nField label={t('editor.shift')} value={form.work_shift} onChange={(v) => set('work_shift', v)} />
          <I18nField label={t('editor.city')} value={form.city} onChange={(v) => set('city', v)} />
          <I18nField label={t('editor.station')} value={form.nearest_station} onChange={(v) => set('nearest_station', v)} />
        </div>
      </Card>

      {/* sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-60">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {err && <p role="alert" className="mr-auto text-sm text-red-700">{errText(err)}</p>}
          {!err && flash && <p role="status" className="mr-auto text-sm text-emerald-700">{flash}</p>}
          {actions.map((a) => (
            <button key={a.label} type="button" className={a.style} disabled={busy} onClick={() => void transition(a.to, a.note)}>
              <a.icon className="h-4 w-4" aria-hidden />{a.label}
            </button>
          ))}
          <button type="submit" className={btn.primary} disabled={busy || leak}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{t('common.save')}
          </button>
        </div>
      </div>
    </form>
  );
}
