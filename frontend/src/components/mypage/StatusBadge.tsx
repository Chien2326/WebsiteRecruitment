'use client';

import { useTranslations } from 'next-intl';
import { CalendarCheck, CircleOff, Hourglass, PartyPopper, Send, type LucideIcon } from 'lucide-react';
import type { ApplicationStatus } from '@/lib/api';

export const STATUS_STYLE: Record<ApplicationStatus, { icon: LucideIcon; cls: string; bar: string }> = {
  applied: { icon: Send, cls: 'bg-sky-50 text-sky-700 ring-sky-200', bar: 'bg-sky-400' },
  reviewing: { icon: Hourglass, cls: 'bg-amber-50 text-amber-800 ring-amber-200', bar: 'bg-amber-400' },
  interview: { icon: CalendarCheck, cls: 'bg-violet-50 text-violet-700 ring-violet-200', bar: 'bg-violet-500' },
  accepted: { icon: PartyPopper, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-500' },
  rejected: { icon: CircleOff, cls: 'bg-slate-100 text-slate-600 ring-slate-200', bar: 'bg-slate-300' },
};

export default function StatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations('status');
  const { icon: Icon, cls } = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {t(status)}
    </span>
  );
}

const STEPS: ApplicationStatus[] = ['applied', 'reviewing', 'interview', 'accepted'];

/** 4-step progress: applied -> reviewing -> interview -> accepted. */
export function StatusStepper({ status }: { status: ApplicationStatus }) {
  const t = useTranslations('status');
  if (status === 'rejected') return <p className="mt-3 text-xs text-slate-500">{t('rejectedNote')}</p>;
  const idx = STEPS.indexOf(status);
  return (
    <ol className="mt-3 grid grid-cols-4 gap-1" aria-label={t(status)}>
      {STEPS.map((s, i) => (
        <li key={s} className="min-w-0">
          <span
            className={`block h-1.5 rounded-full transition-colors duration-500 ${i <= idx ? STATUS_STYLE[status].bar : 'bg-slate-200'}`}
          />
          <span className={`mt-1 block truncate text-[11px] ${i === idx ? 'font-bold text-slate-800' : 'text-slate-400'}`}>
            {t(s)}
          </span>
        </li>
      ))}
    </ol>
  );
}
