/** Admin API shapes (mirror backend app/schemas.py "Phase 5") and small helpers. */
import { csrfToken, type ApplicationStatus, type JapaneseLevel, type Me, type Profile, type Resume } from './api';
import type { I18nText } from './job';

export const ADMIN_LOCALES = ['ja', 'en', 'vi', 'my', 'ne', 'bn'] as const;
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const can = (me: Me | null, perm: string) => !!me?.permissions?.includes(perm);

export type JobStatus = 'draft' | 'pending' | 'published' | 'archived';
export const JOB_STATUSES: JobStatus[] = ['draft', 'pending', 'published', 'archived'];
export const APP_STATUSES: ApplicationStatus[] = ['applied', 'reviewing', 'interview', 'accepted', 'rejected'];
export const FEATURES = ['dormitory', 'no_experience', 'transport_paid', 'english_ok'] as const;
export const STAFF_ROLES = ['super_admin', 'recruiter_manager', 'recruiter', 'content_editor', 'candidate'] as const;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminJobListItem {
  id: string;
  job_code: string;
  title: I18nText;
  status: JobStatus;
  prefecture_id: number;
  salary_type: 'hourly' | 'monthly';
  salary_min: number;
  salary_max: number | null;
  created_at: string;
  published_at: string | null;
  applications_count: number;
  view_count?: number;
}

export interface AdminJob {
  id: string;
  job_code: string;
  status: JobStatus;
  title: I18nText;
  description: I18nText;
  client_display_name: I18nText | null;
  employment_type: 'haken' | 'part_time' | 'full_time' | 'contract';
  salary_type: 'hourly' | 'monthly';
  salary_min: number;
  salary_max: number | null;
  transport_fee_included: boolean;
  prefecture_id: number;
  city: I18nText | null;
  nearest_station: I18nText | null;
  work_shift: I18nText | null;
  work_hours_per_week: number | null;
  japanese_level_required: JapaneseLevel;
  features: string[];
  visa_type_ids: number[];
  review_note: string | null;
  expires_at: string | null;
  published_at: string | null;
  created_by: string;
  end_client_name: string | null;
  end_client_address: string | null;
  internal_note: string | null;
}

export interface AdminApplicationListItem {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  status_changed_at: string;
  job_id: string;
  job_code: string;
  job_title: I18nText;
  has_resume: boolean;
  candidate: { user_id: string; email: string; display_name: string; nationality: string | null; japanese_level: JapaneseLevel };
}

export interface AdminApplicationDetail extends AdminApplicationListItem {
  cover_message: string | null;
  recruiter_note: string | null;
  profile: (Profile & { visa_type: { name: I18nText } | null }) | null;
  resume: Resume | null;
  emails: { template: string; status: string; created_at: string; sent_at: string | null }[];
  history: { from_status: string | null; to_status: string; changed_by: string | null; created_at: string }[];
  /** Who opened the CV: only sent to staff who see all applications (null for client recruiters). */
  resume_access: { accessed_by: string | null; role: string; inline: boolean; created_at: string }[] | null;
}

export interface RegionAdmin {
  id: number;
  code: string;
  name: I18nText;
  sort_order: number;
  is_active: boolean;
}
export interface PrefectureAdmin {
  id: number;
  code: string;
  region_id: number;
  name: I18nText;
  is_active: boolean;
}
export interface TranslationRow {
  key: string;
  locale: string;
  value: string;
  updated_at: string;
}
export interface CmsBlock {
  key: string;
  content: I18nText;
  extra: Record<string, unknown> | null;
  is_published: boolean;
  updated_at: string;
}
export interface UserAdmin {
  id: string;
  email: string;
  role: (typeof STAFF_ROLES)[number];
  is_active: boolean;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
}

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Make public pages pick up an admin change now (Next cache tags), instead of after the TTL. */
export async function revalidate(tags: string[]): Promise<void> {
  await fetch('/api/revalidate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await csrfToken() },
    body: JSON.stringify({ tags }),
  }).catch(() => undefined);
}

/* ---------- Haken guard (mirrors backend admin_jobs.assert_display_name_safe, for instant feedback) ---------- */
const CORP = /(株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|co\.?,?ltd\.?|inc\.?|corp(oration)?\.?|k\.?k\.?|llc|ltd\.?|limited|company)/gi;
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(CORP, '').replace(/[\s・,.\-‐ー_()（）]/g, '');

export function displayRevealsClient(display: I18nText | null, endClient: string): boolean {
  const core = norm(endClient);
  return core.length >= 2 && Object.values(display ?? {}).some((v) => norm(v).includes(core));
}

/* ---------- translation-manager helpers ---------- */
export function flatten(obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (typeof obj === 'string') {
    out[prefix] = obj;
  }
  return out;
}

/** Top-level ICU argument names, e.g. "{count, plural, one {# job}}" + "{name}" -> {count, name}. */
export function placeholders(msg: string): Set<string> {
  return new Set(Array.from(msg.matchAll(/\{\s*([A-Za-z_]\w*)/g), (m) => m[1]));
}
