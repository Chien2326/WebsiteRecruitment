'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, Eye, FileUser, Percent, Table2, UserPlus, Briefcase } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { api, type ApplicationStatus } from '@/lib/api';
import { latn } from '@/lib/format';
import { PREFECTURE_BY_ID, prefectureName } from '@/lib/japan';
import { useFormatter, useLocale } from 'next-intl';
import { AppStatusPill, Card, JobStatusPill, Spinner } from './ui';

/* ---------- API shape (GET /api/v1/admin/analytics) ---------- */
interface Week { start: string; applications: number; views: number; signups: number | null }
interface Analytics {
  weeks: Week[];
  totals: { views_30d: number; applications_30d: number; live_jobs: number; signups_30d: number | null };
  status: Record<ApplicationStatus, number>;
  top_jobs: { id: string; job_code: string; title: string; status: 'draft' | 'pending' | 'published' | 'archived'; views_total: number; views_30d: number; applications_30d: number }[];
  prefectures: { id: number; applications: number }[];
}

const NAVY = '#1F3A5F';
const STATUSES: ApplicationStatus[] = ['applied', 'reviewing', 'interview', 'accepted', 'rejected'];

/** Clean axis top: 1, 2, 5 x 10^n at or above the max (never 0). */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

/**
 * Weekly column chart, one series (so no legend: the card title names it). Columns <= 24px with a 4px rounded top,
 * hairline grid, value tooltip on hover/focus. Every value is also in the table view.
 */
function WeeklyColumns({ weeks, pick, label }: { weeks: Week[]; pick: (w: Week) => number; label: string }) {
  const f = latn(useFormatter());
  const [hover, setHover] = useState<number | null>(null);
  // draw at the real container width (not a scaled viewBox) so axis text stays 11px on phones too
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 200, L = 40, R = 8, T = 12, B = 26;
  const values = weeks.map(pick);
  const top = niceMax(Math.max(0, ...values));
  const band = (W - L - R) / weeks.length;
  const bw = Math.min(24, band - 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const day = (iso: string) => f.dateTime(new Date(`${iso}T00:00:00`), { month: 'numeric', day: 'numeric' });
  const ticks = [0, top / 2, top].filter((v) => Number.isInteger(v));
  const step = Math.ceil(weeks.length / Math.max(2, Math.floor((W - L) / 70))); // ~70px per x label, never crowded

  return (
    <div className="relative" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#E2E8F0" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-slate-500" fontSize={11}>{f.number(v)}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const v = values[i];
          const x = L + band * i + (band - bw) / 2;
          const h = Math.max(0, y(0) - y(v));
          const r = Math.min(4, h, bw / 2);
          return (
            <g key={w.start}>
              {/* hit target = the whole band, larger than the mark */}
              <rect
                x={L + band * i} y={T} width={band} height={H - T - B} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                tabIndex={0} aria-label={`${day(w.start)}: ${f.number(v)}`}
              />
              {v > 0 && (
                <path
                  pointerEvents="none"
                  fill={NAVY}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                  d={`M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z`}
                />
              )}
              {i % step === (weeks.length - 1) % step && (
                <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize={11}>{day(w.start)}</text>
              )}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#CBD5E1" strokeWidth={1} />
      </svg>
      {hover !== null && (() => {
        // keep the tooltip inside the card: anchor left / centre / right depending on the column position
        const pos = (L + band * hover + band / 2) / W;
        const shift = pos > 0.8 ? '-translate-x-full' : pos < 0.2 ? '' : '-translate-x-1/2';
        return (
        <div
          className={`pointer-events-none absolute top-0 whitespace-nowrap rounded-lg bg-white px-2.5 py-1.5 text-xs shadow-md ring-1 ring-slate-200 ${shift}`}
          style={{ left: `${pos * 100}%` }}
        >
          <strong className="block text-sm text-slate-900">{f.number(values[hover])}</strong>
          <span className="text-slate-500">{day(weeks[hover].start)}〜</span>
        </div>
        );
      })()}
    </div>
  );
}

/** Horizontal bars for a ranked list; the label is text (never the bar color), the value sits at the bar tip. */
function HBars({ rows }: { rows: { key: string; label: React.ReactNode; value: number }[] }) {
  const f = latn(useFormatter());
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,9rem)_1fr] items-center gap-3 text-sm">
          <span className="truncate text-slate-700">{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r" style={{ width: `${(r.value / max) * 85}%`, minWidth: r.value ? 3 : 0, background: NAVY }} />
            <span className="tabular-nums text-slate-900">{f.number(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function AnalyticsAdmin() {
  const t = useTranslations('admin');
  const f = latn(useFormatter());
  const locale = useLocale();
  const [data, setData] = useState<Analytics | null>(null);
  const [failed, setFailed] = useState(false);
  const [weeks, setWeeks] = useState(12);
  const [table, setTable] = useState(false);

  useEffect(() => {
    setData(null);
    api<Analytics>(`/admin/analytics?weeks=${weeks}`).then(setData).catch(() => setFailed(true));
  }, [weeks]);

  // applications / views. "–" when there are fewer views than applications: views are only counted since the
  // counter was installed, so older applications have no matching views and the rate would be meaningless.
  const pct = (a: number, b: number) => (b > 0 && a <= b ? `${f.number((a / b) * 100, { maximumFractionDigits: 1 })}%` : '–');
  const showSignups = data?.totals.signups_30d !== null && data?.totals.signups_30d !== undefined;
  const tiles = useMemo(() => {
    if (!data) return [];
    const tt = data.totals;
    return [
      { label: t('analytics.views30'), value: f.number(tt.views_30d), icon: Eye },
      { label: t('analytics.apps30'), value: f.number(tt.applications_30d), icon: FileUser },
      { label: t('analytics.conversion'), value: pct(tt.applications_30d, tt.views_30d), icon: Percent },
      { label: t('analytics.liveJobs'), value: f.number(tt.live_jobs), icon: Briefcase },
      ...(tt.signups_30d !== null ? [{ label: t('analytics.signups30'), value: f.number(tt.signups_30d), icon: UserPlus }] : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (failed) return <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{t('analytics.error')}</p>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy">
          <BarChart3 className="h-6 w-6" aria-hidden />
          {t('analytics.title')}
        </h1>
        {/* filters live in one row above the charts */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t('analytics.range')} className="flex rounded-full border border-slate-300 bg-white p-0.5 text-sm">
            {[4, 12, 26].map((w) => (
              <button
                key={w} type="button" onClick={() => setWeeks(w)} aria-pressed={weeks === w}
                className={`min-h-[36px] whitespace-nowrap rounded-full px-3 ${weeks === w ? 'bg-navy text-white' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {t('analytics.weeks', { n: w })}
              </button>
            ))}
          </div>
          <button
            type="button" onClick={() => setTable((v) => !v)} aria-pressed={table}
            className="inline-flex min-h-[36px] items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:border-navy"
          >
            <Table2 className="h-4 w-4" aria-hidden />
            {table ? t('analytics.showChart') : t('analytics.showTable')}
          </button>
        </div>
      </div>

      {!data ? <Spinner /> : (
        <>
          <p className="text-xs text-slate-500">{t('analytics.note')}</p>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {tiles.map((x) => (
              <div key={x.label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <dt className="flex items-center gap-1.5 text-xs text-slate-500"><x.icon className="h-3.5 w-3.5" aria-hidden />{x.label}</dt>
                <dd className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{x.value}</dd>
              </div>
            ))}
          </dl>

          {table ? (
            <Card title={t('analytics.weeklyTable')}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">{t('analytics.weekOf')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('analytics.applications')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('analytics.views')}</th>
                      {showSignups && <th className="py-2 text-right font-medium">{t('analytics.signups')}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {data.weeks.map((w) => (
                      <tr key={w.start}>
                        <td className="py-1.5 pr-3">{f.dateTime(new Date(`${w.start}T00:00:00`), { dateStyle: 'medium' })}〜</td>
                        <td className="py-1.5 pr-3 text-right">{f.number(w.applications)}</td>
                        <td className="py-1.5 pr-3 text-right">{f.number(w.views)}</td>
                        {showSignups && <td className="py-1.5 text-right">{f.number(w.signups ?? 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card title={t('analytics.appsWeekly')}><WeeklyColumns weeks={data.weeks} pick={(w) => w.applications} label={t('analytics.appsWeekly')} /></Card>
              <Card title={t('analytics.viewsWeekly')}><WeeklyColumns weeks={data.weeks} pick={(w) => w.views} label={t('analytics.viewsWeekly')} /></Card>
              {showSignups && (
                <Card title={t('analytics.signupsWeekly')}><WeeklyColumns weeks={data.weeks} pick={(w) => w.signups ?? 0} label={t('analytics.signupsWeekly')} /></Card>
              )}
              <Card title={t('analytics.byStatus')}>
                <HBars rows={STATUSES.map((s) => ({ key: s, label: <AppStatusPill status={s} />, value: data.status[s] ?? 0 }))} />
              </Card>
            </div>
          )}

          <Card title={t('analytics.topJobs')}>
            {data.top_jobs.length === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm sm:min-w-[36rem]">
                  <thead className="text-left text-xs text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">{t('analytics.job')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('analytics.views30')}</th>
                      <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">{t('analytics.viewsTotal')}</th>
                      <th className="py-2 pr-3 text-right font-medium">{t('analytics.apps30')}</th>
                      <th className="hidden py-2 text-right font-medium sm:table-cell">{t('analytics.conversion')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.top_jobs.map((j, i) => (
                      <tr key={j.id}>
                        <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-slate-500">{i + 1}</td>
                        <td className="py-2 pr-3">
                          <Link href={`/admin/jobs/${j.id}`} className="font-medium text-navy hover:underline">{j.title}</Link>
                          <span className="ml-2 align-middle"><JobStatusPill status={j.status} /></span>
                          <span className="block text-xs text-slate-500">{j.job_code}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{f.number(j.views_30d)}</td>
                        <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">{f.number(j.views_total)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{f.number(j.applications_30d)}</td>
                        <td className="hidden py-2 text-right tabular-nums sm:table-cell">{pct(j.applications_30d, j.views_30d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('analytics.byPrefecture')}>
            {data.prefectures.length === 0 ? <p className="text-sm text-slate-500">{t('analytics.empty')}</p> : (
              <HBars rows={data.prefectures.map((p) => {
                const pref = PREFECTURE_BY_ID.get(p.id);
                return { key: String(p.id), label: pref ? prefectureName(pref, locale) : String(p.id), value: p.applications };
              })} />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
