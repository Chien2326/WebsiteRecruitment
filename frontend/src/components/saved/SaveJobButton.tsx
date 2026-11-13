'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { useSession } from '@/components/auth/SessionProvider';
import { useSavedJobs } from './SavedJobsProvider';

/** Heart toggle. Logged out -> link to login (and back). Staff accounts have no bookmarks -> nothing. */
export default function SaveJobButton({ jobId, withLabel = false, className = '' }: { jobId: string; withLabel?: boolean; className?: string }) {
  const t = useTranslations('jobDetail');
  const te = useTranslations('errors');
  const locale = useLocale();
  const pathname = usePathname();
  const { user, loading } = useSession();
  const { ids, toggle } = useSavedJobs();
  const [busy, setBusy] = useState(false);

  const base = `inline-flex items-center justify-center gap-1.5 rounded-full font-bold transition ${
    withLabel ? 'min-h-[44px] px-4 text-sm ring-1' : 'h-11 w-11'
  } ${className}`;

  if (loading) return null;
  if (!user) {
    return (
      <Link href={{ pathname: '/login', query: { next: `/${locale}${pathname}` } }} className={`${base} bg-white text-slate-500 ring-slate-200 hover:text-brand`}
        aria-label={t('saveLogin')} title={t('saveLogin')}>
        <Heart className="h-5 w-5" aria-hidden />
        {withLabel && t('save')}
      </Link>
    );
  }
  if (!ids) return null;

  const saved = ids.has(jobId);
  async function onClick() {
    setBusy(true);
    try {
      await toggle(jobId);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'generic';
      window.alert(te.has(code) ? te(code) : te('generic'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" onClick={() => void onClick()} disabled={busy} aria-pressed={saved}
      aria-label={saved ? t('saved') : t('save')} title={saved ? t('saved') : t('save')}
      className={`${base} ${saved ? 'bg-brand-light text-brand ring-brand/40' : 'bg-white text-slate-500 ring-slate-200 hover:text-brand'}`}>
      <Heart className={`h-5 w-5 ${saved ? 'fill-current' : ''}`} aria-hidden />
      {withLabel && (saved ? t('saved') : t('save'))}
    </button>
  );
}
