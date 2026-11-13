'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, ChevronLeft, FileText, IdCard, Languages, Loader2, MapPin, UserRound } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { ApiError, api, type JapaneseLevel, type Profile, type VisaType } from '@/lib/api';
import { REGION_CODES, prefectureName, prefecturesOf } from '@/lib/japan';
import { localize } from '@/lib/job';
import ResumeManager from './ResumeManager';

const LEVELS: JapaneseLevel[] = ['none', 'n5', 'n4', 'n3', 'n2', 'n1'];
// Most common nationalities of foreign workers in Japan; names come from the browser (Intl), localized for free.
const NATIONALITIES = ['VN', 'MM', 'NP', 'BD', 'PH', 'ID', 'CN', 'LK', 'IN', 'KH', 'TH', 'MN', 'UZ', 'BR', 'PE', 'KR', 'US'];

const EMPTY: Profile = {
  first_name: '', last_name: '', first_name_kana: null, last_name_kana: null, birth_date: null, nationality: null,
  phone: null, current_prefecture_id: null, japanese_level: 'none', visa_type_id: null, visa_expiry_date: null,
  years_of_experience: 0, experience_summary: null, desired_prefecture_ids: [],
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <legend className="flex items-center gap-2 px-1 text-sm font-bold text-navy">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-light text-brand" aria-hidden>{icon}</span>
        {title}
      </legend>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export default function ProfileForm() {
  const t = useTranslations('profile');
  const te = useTranslations('errors');
  const tl = useTranslations('jobDetail.level');
  const tr = useTranslations('regions');
  const tm = useTranslations('mypage');
  const locale = useLocale();
  const [p, setP] = useState<Profile | null>(null);
  const [visas, setVisas] = useState<VisaType[]>([]);
  const [resumeCount, setResumeCount] = useState(0);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<Profile | null>('/me/profile').then((d) => setP({ ...EMPTY, ...(d ?? {}) })).catch(() => setP(EMPTY));
    fetch('/api/v1/visa-types').then((r) => r.json()).then(setVisas).catch(() => setVisas([]));
  }, []);

  const countryName = useMemo(() => {
    try {
      const dn = new Intl.DisplayNames([locale, 'en'], { type: 'region' });
      return (c: string) => dn.of(c) ?? c;
    } catch {
      return (c: string) => c;
    }
  }, [locale]);

  const set = useCallback(<K extends keyof Profile>(k: K, v: Profile[K]) => {
    setP((prev) => (prev ? { ...prev, [k]: v } : prev));
    setState('idle');
  }, []);

  // completeness: what a recruiter needs to call you back
  const percent = useMemo(() => {
    if (!p) return 0;
    const checks = [p.last_name, p.first_name, p.birth_date, p.nationality, p.phone, p.current_prefecture_id,
      p.visa_type_id, p.japanese_level !== 'none' ? 1 : null, p.experience_summary, resumeCount > 0 ? 1 : null];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [p, resumeCount]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    setState('saving');
    setErr(null);
    const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);
    try {
      const saved = await api<Profile>('/me/profile', {
        method: 'PUT',
        json: {
          ...p,
          first_name_kana: blank(p.first_name_kana), last_name_kana: blank(p.last_name_kana),
          phone: blank(p.phone), experience_summary: blank(p.experience_summary),
          birth_date: p.birth_date || null, visa_expiry_date: p.visa_expiry_date || null,
        },
      });
      setP({ ...EMPTY, ...saved });
      setState('saved');
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.code : 'generic');
      setState('idle');
    }
  }

  if (!p) {
    return <div className="grid min-h-[40vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden /></div>;
  }

  const field = 'min-h-[48px] w-full rounded-xl border border-slate-200 bg-white px-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30';
  const label = 'mb-1 block text-sm font-medium text-slate-700';

  return (
    <div className="space-y-5">
      <Link href="/mypage" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-navy hover:underline">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t('backToMypage')}
      </Link>

      <section className="rounded-3xl bg-gradient-to-br from-navy-light via-white to-brand-light p-5">
        <h1 className="text-xl font-bold text-navy md:text-2xl">{t('title')}</h1>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-white shadow-inner" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${percent === 100 ? 'bg-emerald-500' : 'bg-brand'}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-sm font-bold tabular-nums text-navy">{t('completion', { percent })}</span>
        </div>
        {!p.first_name && <p className="mt-2 text-sm text-slate-600">{tm('profileCardText')}</p>}
      </section>

      <form onSubmit={save} className="space-y-4">
        <Section icon={<UserRound className="h-4 w-4" />} title={t('basic')}>
          <label><span className={label}>{t('lastName')} *</span>
            <input className={field} required maxLength={100} autoComplete="family-name" value={p.last_name} onChange={(e) => set('last_name', e.target.value)} /></label>
          <label><span className={label}>{t('firstName')} *</span>
            <input className={field} required maxLength={100} autoComplete="given-name" value={p.first_name} onChange={(e) => set('first_name', e.target.value)} /></label>
          <label><span className={label}>{t('lastNameKana')}</span>
            <input className={field} maxLength={100} value={p.last_name_kana ?? ''} onChange={(e) => set('last_name_kana', e.target.value)} /></label>
          <label><span className={label}>{t('firstNameKana')}</span>
            <input className={field} maxLength={100} value={p.first_name_kana ?? ''} onChange={(e) => set('first_name_kana', e.target.value)} /></label>
          <label><span className={label}>{t('birthDate')}</span>
            <input type="date" className={field} autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={p.birth_date ?? ''} onChange={(e) => set('birth_date', e.target.value || null)} /></label>
          <label><span className={label}>{t('nationality')}</span>
            <select className={field} value={p.nationality ?? ''} onChange={(e) => set('nationality', e.target.value || null)}>
              <option value="">{t('select')}</option>
              {NATIONALITIES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </select></label>
          <label className="sm:col-span-2"><span className={label}>{t('phone')}</span>
            <input type="tel" inputMode="tel" autoComplete="tel" pattern="\+?[0-9\-]{8,20}" placeholder={t('phoneHint')} className={field} value={p.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></label>
        </Section>

        <Section icon={<IdCard className="h-4 w-4" />} title={t('residence')}>
          <label><span className={label}>{t('visa')}</span>
            <select className={field} value={p.visa_type_id ?? ''} onChange={(e) => set('visa_type_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('select')}</option>
              {visas.map((v) => <option key={v.id} value={v.id}>{localize(v.name, locale)}</option>)}
            </select></label>
          <label><span className={label}>{t('visaExpiry')}</span>
            <input type="date" className={field} value={p.visa_expiry_date ?? ''} onChange={(e) => set('visa_expiry_date', e.target.value || null)} /></label>
        </Section>

        <Section icon={<Languages className="h-4 w-4" />} title={t('language')}>
          <div className="sm:col-span-2">
            <span className={label}>{t('japaneseLevel')}</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('japaneseLevel')}>
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  role="radio"
                  aria-checked={p.japanese_level === lv}
                  onClick={() => set('japanese_level', lv)}
                  className={`min-h-[44px] rounded-full px-4 text-sm font-bold ring-1 transition ${
                    p.japanese_level === lv ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand'
                  }`}
                >
                  {tl(lv)}
                </button>
              ))}
            </div>
          </div>
          <label><span className={label}>{t('years')}</span>
            <input type="number" min={0} max={60} inputMode="numeric" className={field} value={p.years_of_experience} onChange={(e) => set('years_of_experience', Math.max(0, Math.min(60, Number(e.target.value) || 0)))} /></label>
          <label className="sm:col-span-2"><span className={label}>{t('summary')}</span>
            <textarea rows={4} maxLength={5000} placeholder={t('summaryPlaceholder')} className={`${field} py-2`} value={p.experience_summary ?? ''} onChange={(e) => set('experience_summary', e.target.value)} /></label>
        </Section>

        <Section icon={<MapPin className="h-4 w-4" />} title={t('location')}>
          <label className="sm:col-span-2"><span className={label}>{t('currentPrefecture')}</span>
            <select className={field} value={p.current_prefecture_id ?? ''} onChange={(e) => set('current_prefecture_id', e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('select')}</option>
              {REGION_CODES.map((r) => (
                <optgroup key={r} label={tr(r)}>
                  {prefecturesOf(r).map((x) => <option key={x.id} value={x.id}>{prefectureName(x, locale)}</option>)}
                </optgroup>
              ))}
            </select></label>
          <fieldset className="sm:col-span-2">
            <legend className={label}>{t('desiredPrefectures')}</legend>
            <p className="mb-2 text-xs text-slate-500">{t('desiredHint', { count: p.desired_prefecture_ids.length })}</p>
            <div className="space-y-2">
              {REGION_CODES.map((r) => (
                <div key={r} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-full text-xs font-bold text-slate-500 sm:w-24">{tr(r)}</span>
                  {prefecturesOf(r).map((x) => {
                    const on = p.desired_prefecture_ids.includes(x.id);
                    return (
                      <button key={x.id} type="button" aria-pressed={on}
                        onClick={() => set('desired_prefecture_ids', on ? p.desired_prefecture_ids.filter((i) => i !== x.id) : [...p.desired_prefecture_ids, x.id].sort((a, b) => a - b))}
                        className={`min-h-[36px] rounded-full px-3 text-sm ring-1 transition ${on ? 'bg-brand font-bold text-white ring-brand' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand'}`}>
                        {prefectureName(x, locale)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </fieldset>
        </Section>

        {err && (
          <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {te.has(err) ? te(err) : te('generic')}
          </p>
        )}

        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
          <button
            type="submit"
            disabled={state === 'saving'}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand px-6 font-bold text-white hover:bg-brand-dark disabled:opacity-60 md:mx-auto md:flex md:w-auto md:min-w-[280px]"
          >
            {state === 'saving' && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}
            {state === 'saved' && <CheckCircle2 className="h-5 w-5" aria-hidden />}
            {state === 'saving' ? t('saving') : state === 'saved' ? t('saved') : t('save')}
          </button>
        </div>
      </form>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="resumes-title">
        <h2 id="resumes-title" className="mb-3 flex items-center gap-2 text-sm font-bold text-navy">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-light text-brand" aria-hidden><FileText className="h-4 w-4" /></span>
          {t('resumes')}
        </h2>
        <ResumeManager onCountChange={setResumeCount} />
      </section>
    </div>
  );
}
