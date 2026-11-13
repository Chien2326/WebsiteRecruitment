'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, MapPin } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import {
  GRID_COLS, GRID_ROWS, PREFECTURES, PREFECTURE_BY_ID, REGION_CODES, REGION_COLORS,
  REGION_LABEL_ANCHOR, isPrefectureActive, isRegionActive, placeName, prefectureShortName, prefecturesOf,
  type PlacesInfo, type Prefecture, type RegionCode,
} from '@/lib/japan';
import type { PrefectureCounts } from '@/lib/job';
import { latn } from '@/lib/format';

/* ---------- geometry (SVG user units) ---------- */
const CELL = 44;
const GAP = 4;
const W = GRID_COLS * CELL;
const H = GRID_ROWS * CELL;
const MAX_ZOOM = 3.2;
const BRAND = '#D9232D';
const NAVY = '#1F3A5F';

const REGION_BOX = Object.fromEntries(
  REGION_CODES.map((r) => {
    const ps = prefecturesOf(r);
    return [r, {
      x0: Math.min(...ps.map((p) => p.x)),
      y0: Math.min(...ps.map((p) => p.y)),
      x1: Math.max(...ps.map((p) => p.x + (p.w ?? 1))),
      y1: Math.max(...ps.map((p) => p.y + (p.h ?? 1))),
    }];
  }),
) as Record<RegionCode, { x0: number; y0: number; x1: number; y1: number }>;

/** Transform that fits a region's bounding box into the viewBox (identity for the national view). */
function zoomTo(r: RegionCode | null) {
  if (!r) return { s: 1, tx: 0, ty: 0 };
  const b = REGION_BOX[r];
  const pad = 0.6;
  const bw = (b.x1 - b.x0 + pad * 2) * CELL;
  const bh = (b.y1 - b.y0 + pad * 2) * CELL;
  const s = Math.min(W / bw, H / bh, MAX_ZOOM);
  return {
    s,
    tx: (W - bw * s) / 2 - (b.x0 - pad) * CELL * s,
    ty: (H - bh * s) / 2 - (b.y0 - pad) * CELL * s,
  };
}

/** Rough text width for pill sizing: CJK glyphs are ~1em, everything else ~0.62em. */
function textWidth(s: string, size: number) {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? size : size * 0.62;
  return w;
}

const activateOnKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

type Props = {
  counts: PrefectureCounts | null;
  /** navigate: go to /jobs?prefecture=…  |  filter: update the current /jobs query in place */
  mode: 'navigate' | 'filter';
  selectedPrefectureId?: number;
  selectedRegion?: RegionCode;
  /** current keyword, preserved when the map changes the location filter */
  keyword?: string;
  /** admin overlay: hidden regions/prefectures + edited names */
  places?: PlacesInfo | null;
};

export default function JapanMap({ counts, mode, selectedPrefectureId, selectedRegion, keyword, places }: Props) {
  const t = useTranslations('map');
  const tr = useTranslations('regions');
  const locale = useLocale();
  const format = latn(useFormatter());
  const router = useRouter();

  const [active, setActive] = useState<RegionCode | null>(
    selectedRegion ?? (selectedPrefectureId ? PREFECTURE_BY_ID.get(selectedPrefectureId)?.region : undefined) ?? null,
  );

  const regionTotals = useMemo(() => {
    const out = Object.fromEntries(REGION_CODES.map((r) => [r, 0])) as Record<RegionCode, number>;
    for (const p of PREFECTURES) out[p.region] += counts?.[p.id] ?? 0;
    return out;
  }, [counts]);

  const countOf = (id: number) => counts?.[id] ?? 0;
  const name = (p: Prefecture) => placeName(p, locale, places);
  const rname = (r: RegionCode) => places?.regions[r]?.name?.[locale] || tr(r);
  const regions = REGION_CODES.filter((r) => isRegionActive(r, places));
  const jobsLabel = (n: number) => t('jobs', { count: n });
  const { s, tx, ty } = zoomTo(active);

  function go(query: Record<string, string>) {
    if (mode === 'filter' && keyword) query.q = keyword;
    if (mode === 'navigate') router.push({ pathname: '/jobs', query });
    else router.replace({ pathname: '/jobs', query }, { scroll: false });
  }
  const selectPrefecture = (id: number) => go({ prefecture: String(id) });
  const selectWholeRegion = (r: RegionCode) => go({ region: r });
  // First tap on a region zooms in; a tap on a tile of the zoomed region selects that prefecture.
  const onTile = (p: Prefecture) => (active === p.region ? selectPrefecture(p.id) : setActive(p.region));

  const Count = ({ n, inverted = false }: { n: number; inverted?: boolean }) =>
    counts ? (
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
          n === 0 ? 'bg-slate-100 text-slate-400' : inverted ? 'bg-white text-brand' : 'bg-brand text-white'
        }`}
      >
        {format.number(n)}
      </span>
    ) : null;

  return (
    <section aria-labelledby="japan-map-title" className="rounded-3xl border border-slate-200 bg-gradient-to-b from-sky-50 to-white p-3 shadow-sm md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="japan-map-title" className="flex items-center gap-2 text-lg font-bold text-navy">
            <MapPin className="h-5 w-5 text-brand" aria-hidden />
            {t('title')}
          </h2>
          <p className="text-sm text-slate-600">{active ? rname(active) : t('subtitle')}</p>
        </div>
        {active && (
          <button
            type="button"
            onClick={() => setActive(null)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-navy hover:border-brand"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {t('backToJapan')}
          </button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{active ? rname(active) : t('allJapan')}</p>

      {/* ---------------- the map ---------------- */}
      <div className="mx-auto mt-2 max-w-xl overflow-hidden">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-manipulation select-none"
          role="group"
          aria-label={t('mapLabel')}
        >
          <g
            className="motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out"
            style={{ transform: `translate(${tx}px, ${ty}px) scale(${s})`, transformOrigin: '0 0' }}
          >
            {PREFECTURES.map((p) => {
              const x = p.x * CELL + GAP / 2;
              const y = p.y * CELL + GAP / 2;
              const w = (p.w ?? 1) * CELL - GAP;
              const h = (p.h ?? 1) * CELL - GAP;
              const n = countOf(p.id);
              const zoomed = active === p.region;
              const selected = p.id === selectedPrefectureId;
              const regionSelected = !selectedPrefectureId && selectedRegion === p.region;
              const color = REGION_COLORS[p.region];
              if (!isPrefectureActive(p, places)) {
                // hidden by an admin: neutral land, not interactive
                return <rect key={p.id} x={x} y={y} width={w} height={h} rx={7} fill="#E2E8F0" opacity={active && !zoomed ? 0.3 : 0.6} aria-hidden />;
              }
              const label = locale !== 'ja' && places?.prefectures[p.id]?.name?.[locale] ? name(p) : prefectureShortName(p, locale);
              const fs = Math.min(9, (w - 6) / textWidth(label, 1));
              const num = format.number(n);
              const bw = textWidth(num, 7.5) + 8;
              return (
                <g
                  key={p.id}
                  role="button"
                  tabIndex={zoomed ? 0 : -1}
                  aria-label={`${name(p)}: ${jobsLabel(n)}`}
                  aria-pressed={selected}
                  onClick={() => onTile(p)}
                  onKeyDown={activateOnKey(() => onTile(p))}
                  opacity={active && !zoomed ? 0.3 : 1}
                  className="group cursor-pointer outline-none"
                >
                  <rect
                    x={x} y={y} width={w} height={h} rx={7}
                    fill={selected ? BRAND : regionSelected ? color.strong : color.fill}
                    fillOpacity={counts && n === 0 && !selected ? 0.55 : 1}
                    stroke="#fff"
                    strokeWidth={1.5}
                    className="transition-[stroke] group-hover:stroke-navy group-focus-visible:stroke-navy group-focus-visible:[stroke-width:3]"
                  />
                  {zoomed && (
                    <>
                      <text
                        x={x + w / 2} y={y + h / 2 - (counts ? 5 : 0)}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={fs} fontWeight={700} fill={selected ? '#fff' : NAVY}
                      >
                        {label}
                      </text>
                      {counts && (
                        <g aria-hidden>
                          <rect
                            x={x + w / 2 - bw / 2} y={y + h / 2 + 3} width={bw} height={11} rx={5.5}
                            fill={selected ? '#fff' : n ? BRAND : '#CBD5E1'}
                          />
                          <text
                            x={x + w / 2} y={y + h / 2 + 8.5}
                            textAnchor="middle" dominantBaseline="central"
                            fontSize={7.5} fontWeight={700} fill={selected ? BRAND : '#fff'}
                          >
                            {num}
                          </text>
                        </g>
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>

          {/* National view: one badge per region (name + live job count) */}
          {!active &&
            regions.map((r) => {
              const a = REGION_LABEL_ANCHOR[r];
              const label = rname(r);
              const num = counts ? format.number(regionTotals[r]) : null;
              const fs = 17;
              const wName = textWidth(label, fs);
              const wNum = num ? textWidth(num, 14) + 16 : 0;
              const pw = wName + wNum + (num ? 26 : 20);
              const ph = 34;
              return (
                <g
                  key={r}
                  role="button"
                  tabIndex={0}
                  aria-label={`${label}: ${jobsLabel(regionTotals[r])}`}
                  onClick={() => setActive(r)}
                  onKeyDown={activateOnKey(() => setActive(r))}
                  transform={`translate(${a.x * CELL - pw / 2} ${a.y * CELL - ph / 2})`}
                  className="group cursor-pointer outline-none"
                >
                  <rect
                    width={pw} height={ph} rx={ph / 2} fill="#fff"
                    stroke={REGION_COLORS[r].strong} strokeWidth={2.5}
                    className="group-hover:[stroke:#1F3A5F] group-focus-visible:[stroke:#1F3A5F] group-focus-visible:[stroke-width:4]"
                  />
                  <text x={10} y={ph / 2} dominantBaseline="central" fontSize={fs} fontWeight={700} fill={NAVY}>
                    {label}
                  </text>
                  {num && (
                    <>
                      <rect x={16 + wName} y={6} width={wNum} height={ph - 12} rx={(ph - 12) / 2} fill={BRAND} />
                      <text
                        x={16 + wName + wNum / 2} y={ph / 2}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize={14} fontWeight={700} fill="#fff"
                      >
                        {num}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
        </svg>
      </div>

      {/* ---------------- big tap targets under the map (also the keyboard / screen-reader path) ---------------- */}
      {!active ? (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {regions.map((r) => (
            <li key={r}>
              <button
                type="button"
                onClick={() => setActive(r)}
                style={{ borderLeftColor: REGION_COLORS[r].strong }}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl border border-l-[6px] border-slate-200 bg-white px-3 py-2 text-left text-sm font-bold text-navy hover:bg-slate-50"
              >
                <span>{rname(r)}</span>
                <Count n={regionTotals[r]} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-bold text-navy">{t('prefecturesIn', { region: rname(active) })}</p>
          <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <li className="col-span-2 sm:col-span-3">
              <button
                type="button"
                onClick={() => selectWholeRegion(active)}
                aria-pressed={!selectedPrefectureId && selectedRegion === active}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl bg-navy px-4 py-2 text-left text-sm font-bold text-white hover:bg-navy/90"
              >
                <span>{t('regionAll', { region: rname(active) })}</span>
                <Count n={regionTotals[active]} inverted />
              </button>
            </li>
            {prefecturesOf(active).filter((p) => isPrefectureActive(p, places)).map((p) => {
              const selected = p.id === selectedPrefectureId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => selectPrefecture(p.id)}
                    aria-pressed={selected}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium hover:border-brand ${
                      selected ? 'border-brand bg-brand-light text-brand' : 'border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <span>{name(p)}</span>
                    <Count n={countOf(p.id)} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
