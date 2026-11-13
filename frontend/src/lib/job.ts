import type { PlacesInfo } from './japan';

/** Public job shape: mirrors backend `JobPublic` (no end-client fields, by design). */
export type I18nText = Record<string, string>;

export interface JobPublic {
  id: string;
  job_code: string;
  title: I18nText;
  description: I18nText;
  employment_type: 'haken' | 'part_time' | 'full_time' | 'contract';
  salary_type: 'hourly' | 'monthly';
  salary_min: number;
  salary_max: number | null;
  transport_fee_included: boolean;
  prefecture: { id: number; code: string; name: I18nText };
  city: I18nText | null;
  nearest_station: I18nText | null;
  work_shift: I18nText | null;
  work_hours_per_week: number | null;
  japanese_level_required: 'none' | 'n5' | 'n4' | 'n3' | 'n2' | 'n1';
  features: string[];
  visa_types: { id: number; code: string; name: I18nText }[];
  published_at: string;
  /** Public application deadline (null = open-ended). */
  expires_at?: string | null;
  /** Public company line for Haken jobs (never the real end-client). */
  client_display_name?: I18nText | null;
}

/** Pick the user's language, fall back to Japanese, then anything. Mirrors backend `localize()`. */
export function localize(v: I18nText | null | undefined, locale: string): string {
  if (!v) return '';
  return v[locale] || v.ja || Object.values(v)[0] || '';
}

const API_URL = process.env.API_URL ?? 'http://localhost:8000';

/** Card shape returned by `GET /api/v1/jobs` (mirrors backend `JobListItem`). */
export type JobListItem = Pick<
  JobPublic,
  | 'id' | 'job_code' | 'title' | 'employment_type' | 'salary_type' | 'salary_min' | 'salary_max'
  | 'prefecture' | 'japanese_level_required' | 'features' | 'published_at'
> & Partial<Pick<JobPublic, 'nearest_station' | 'work_hours_per_week' | 'transport_fee_included'>>;

/** Jobs posted in the last 7 days get a "NEW" badge. */
export const NEW_DAYS = 7;
export function isNewJob(publishedAt: string | null | undefined, now = Date.now()): boolean {
  if (!publishedAt) return false;
  const age = now - new Date(publishedAt).getTime();
  return age >= 0 && age < NEW_DAYS * 86_400_000;
}

/**
 * Rough monthly income for hourly jobs: middle of the pay range x hours/week x 52/12, rounded down to
 * 1,000円. Only an estimate (before tax, no overtime) - the UI says so. null when it cannot be computed.
 */
export function monthlyEstimate(job: Pick<JobPublic, 'salary_type' | 'salary_min' | 'salary_max'> & { work_hours_per_week?: number | null }): number | null {
  if (job.salary_type !== 'hourly' || !job.work_hours_per_week) return null;
  const hourly = job.salary_max ? (job.salary_min + job.salary_max) / 2 : job.salary_min;
  return Math.floor((hourly * job.work_hours_per_week * 52) / 12 / 1000) * 1000;
}

/** Other live jobs near this one (same prefecture first). Never throws: [] on any error. */
export async function getSimilarJobs(ref: string, limit = 4): Promise<JobListItem[]> {
  try {
    const r = await fetch(`${API_URL}/api/v1/jobs/${encodeURIComponent(ref)}/similar?limit=${limit}`, { next: { revalidate: 60 } });
    return r.ok ? ((await r.json()) as JobListItem[]) : [];
  } catch {
    return [];
  }
}

export interface JobFilters {
  prefecture?: number;
  region?: string;
  q?: string;
}

export async function searchJobs(f: JobFilters, limit = 50): Promise<JobListItem[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (f.prefecture) qs.set('prefecture_id', String(f.prefecture));
  else if (f.region) qs.set('region', f.region);
  if (f.q) qs.set('q', f.q);
  const res = await fetch(`${API_URL}/api/v1/jobs?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as JobListItem[];
}

/* ---------- paginated search with every filter (GET /api/v1/jobs/search) ---------- */
export const LEVELS = ['none', 'n5', 'n4', 'n3', 'n2', 'n1'] as const;
export const EMPLOYMENT_TYPES = ['haken', 'part_time', 'full_time', 'contract'] as const;
export const FEATURE_KEYS = ['dormitory', 'no_experience', 'transport_paid', 'english_ok'] as const;
export const HOURLY_STEPS = [1100, 1200, 1300, 1500, 1800] as const;
export const JOBS_PAGE_SIZE = 20;

export interface JobSearch extends JobFilters {
  level?: (typeof LEVELS)[number];
  visa?: string;
  minHourly?: number;
  employment?: (typeof EMPLOYMENT_TYPES)[number];
  features?: string[];
  sort?: 'new' | 'salary';
  page?: number;
}

export interface JobSearchPage {
  items: JobListItem[];
  total: number;
  page: number;
  page_size: number;
}

/** Filters -> the jobs page's own URL query (also used for pagination links). */
export function jobSearchQuery(f: JobSearch): Record<string, string | string[]> {
  const q: Record<string, string | string[]> = {};
  if (f.prefecture) q.prefecture = String(f.prefecture);
  else if (f.region) q.region = f.region;
  if (f.q) q.q = f.q;
  if (f.level) q.level = f.level;
  if (f.visa) q.visa = f.visa;
  if (f.minHourly) q.min_hourly = String(f.minHourly);
  if (f.employment) q.employment = f.employment;
  if (f.features?.length) q.features = f.features;
  if (f.sort && f.sort !== 'new') q.sort = f.sort;
  if (f.page && f.page > 1) q.page = String(f.page);
  return q;
}

export async function searchJobsPage(f: JobSearch): Promise<JobSearchPage> {
  const qs = new URLSearchParams({ page: String(f.page ?? 1), page_size: String(JOBS_PAGE_SIZE) });
  if (f.prefecture) qs.set('prefecture_id', String(f.prefecture));
  else if (f.region) qs.set('region', f.region);
  if (f.q) qs.set('q', f.q);
  if (f.level) qs.set('level', f.level);
  if (f.visa) qs.set('visa', f.visa);
  if (f.minHourly) qs.set('min_hourly', String(f.minHourly));
  if (f.employment) qs.set('employment', f.employment);
  for (const x of f.features ?? []) qs.append('features', x);
  if (f.sort) qs.set('sort', f.sort);
  const res = await fetch(`${API_URL}/api/v1/jobs/search?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as JobSearchPage;
}

export interface VisaTypeInfo {
  id: number;
  code: string;
  name: I18nText;
}

export async function getVisaTypes(): Promise<VisaTypeInfo[]> {
  try {
    const r = await fetch(`${API_URL}/api/v1/visa-types`, { next: { revalidate: 3600 } });
    return r.ok ? ((await r.json()) as VisaTypeInfo[]) : [];
  } catch {
    return [];
  }
}

export type PrefectureCounts = Record<number, number>;

/**
 * Live job counts per prefecture for the map badges. Cached 60s by Next (ISR), so the home page
 * stays static and the API sees at most one request per minute. Returns null if the API is down:
 * the map still renders, just without numbers.
 */
export async function getPrefectureCounts(): Promise<PrefectureCounts | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/stats/jobs-by-prefecture`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = (await res.json()) as { counts: Record<string, number> };
    return Object.fromEntries(Object.entries(data.counts).map(([k, v]) => [Number(k), v]));
  } catch {
    return null;
  }
}

/** Salary line, e.g. "時給 1,200円〜1,500円". `t` = translator for the `jobDetail` namespace. */
export function salaryText(
  t: (key: string, values: Record<string, string>) => string,
  formatNumber: (n: number) => string,
  job: Pick<JobPublic, 'salary_type' | 'salary_min' | 'salary_max'>,
): string {
  const key = job.salary_type === 'hourly' ? 'salaryHourly' : 'salaryMonthly';
  const min = formatNumber(job.salary_min);
  return job.salary_max
    ? t(key, { min, max: formatNumber(job.salary_max) })
    : t(`${key}From`, { min });
}

/** Server-side fetch of a published job from FastAPI (`ref` = UUID or job code). Returns null on 404. */
export async function getJob(ref: string): Promise<JobPublic | null> {
  const res = await fetch(`${API_URL}/api/v1/jobs/${encodeURIComponent(ref)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as JobPublic;
}

/* ---------- admin-managed data (cached + tagged; admin saves revalidate the tag) ---------- */
export async function getPlaces(): Promise<PlacesInfo | null> {
  try {
    const r = await fetch(`${API_URL}/api/v1/places`, { next: { revalidate: 300, tags: ['places'] } });
    if (!r.ok) return null;
    const d = (await r.json()) as {
      regions: { code: string; name: Record<string, string>; is_active: boolean }[];
      prefectures: { id: number; name: Record<string, string>; is_active: boolean }[];
    };
    return {
      regions: Object.fromEntries(d.regions.map((x) => [x.code, { name: x.name, active: x.is_active }])),
      prefectures: Object.fromEntries(d.prefectures.map((x) => [x.id, { name: x.name, active: x.is_active }])),
    };
  } catch {
    return null;
  }
}

export async function getCmsBlock(key: string): Promise<I18nText | null> {
  try {
    const r = await fetch(`${API_URL}/api/v1/cms/${encodeURIComponent(key)}`, { next: { revalidate: 300, tags: ['cms'] } });
    return r.ok ? ((await r.json()) as { content: I18nText }).content : null;
  } catch {
    return null;
  }
}
