/**
 * Browser-side API client for authenticated calls (same-origin /api, proxied to FastAPI).
 * - Cookies are HttpOnly: this code never sees the access/refresh tokens.
 * - Adds the double-submit CSRF header on state-changing requests.
 * - On 401 tries one silent refresh (shared across concurrent calls), then retries once.
 */
import type { I18nText } from './job';

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

/* ---------- shapes (mirror backend schemas) ---------- */
export type Role = 'super_admin' | 'recruiter_manager' | 'content_editor' | 'recruiter' | 'candidate';
export interface Me {
  id: string;
  email: string;
  role: Role;
  preferred_locale: string;
  display_name: string | null;
  profile_complete: boolean;
  providers: ('google' | 'apple')[];
  /** RBAC permissions (UI hints only; the API enforces them). */
  permissions: string[];
  email_verified: boolean;
  /** false for Google/Apple-only accounts: they can set a first password without a current one. */
  has_password: boolean;
}
export interface Resume {
  id: string;
  original_filename: string;
  file_type: 'pdf' | 'docx';
  file_size_bytes: number;
  is_default: boolean;
  uploaded_at: string;
}
export type ApplicationStatus = 'applied' | 'reviewing' | 'interview' | 'accepted' | 'rejected';
export interface MyApplication {
  id: string;
  status: ApplicationStatus;
  created_at: string;
  status_changed_at: string;
  job: {
    id: string;
    job_code: string;
    title: I18nText;
    salary_type: 'hourly' | 'monthly';
    salary_min: number;
    salary_max: number | null;
    prefecture: { id: number };
  };
}
export type JapaneseLevel = 'none' | 'n5' | 'n4' | 'n3' | 'n2' | 'n1';
export interface Profile {
  first_name: string;
  last_name: string;
  first_name_kana: string | null;
  last_name_kana: string | null;
  birth_date: string | null;
  nationality: string | null;
  phone: string | null;
  current_prefecture_id: number | null;
  japanese_level: JapaneseLevel;
  visa_type_id: number | null;
  visa_expiry_date: string | null;
  years_of_experience: number;
  experience_summary: string | null;
  desired_prefecture_ids: number[];
}
export interface VisaType {
  id: number;
  code: string;
  name: I18nText;
}

/* ---------- internals ---------- */
const BASE = '/api/v1';

function readCookie(name: string): string | undefined {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
}

/** True if this browser has had a session (logout clears it). Lets anonymous visitors skip /me entirely. */
export function maybeLoggedIn(): boolean {
  return typeof document !== 'undefined' && !!readCookie('csrf_token');
}

export async function csrfToken(): Promise<string> {
  const existing = readCookie('csrf_token');
  if (existing) return existing;
  const r = await fetch(`${BASE}/auth/csrf`, { credentials: 'same-origin' });
  return ((await r.json()) as { csrf_token: string }).csrf_token;
}

let refreshing: Promise<boolean> | null = null;

/** One in-flight refresh for the whole tab, however many requests hit 401 at once. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': await csrfToken() },
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET' && method !== 'HEAD') headers.set('X-CSRF-Token', await csrfToken());
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return fetch(`${BASE}${path}`, { ...init, method, headers, credentials: 'same-origin' });
}

async function errorCode(res: Response): Promise<string> {
  try {
    const d = (await res.json()) as { detail?: { code?: string } | unknown };
    const code = (d.detail as { code?: string } | undefined)?.code;
    if (code) return code;
  } catch {
    /* non-JSON error body */
  }
  return res.status === 422 ? 'validation' : 'generic';
}

/* ---------- public API ---------- */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  if (json !== undefined) rest.body = JSON.stringify(json);
  let res: Response;
  try {
    res = await send(path, rest);
    if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) res = await send(path, rest);
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Multipart upload with progress (fetch has no upload progress, XHR does). */
export async function uploadResume(file: File, onProgress: (pct: number) => void): Promise<Resume> {
  const attempt = async () => {
    const token = await csrfToken();
    return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/resumes/upload`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-CSRF-Token', token);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          /* empty */
        }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new ApiError(0, 'network'));
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    });
  };
  let r = await attempt();
  if (r.status === 401 && (await refreshSession())) r = await attempt();
  if (r.status >= 400) {
    const code = (r.body as { detail?: { code?: string } } | null)?.detail?.code;
    throw new ApiError(r.status, code ?? (r.status === 413 ? 'file_too_large' : 'generic'));
  }
  return r.body as Resume;
}

/** Same rule as the backend: only same-site relative paths. */
export function safeNext(v: string | null | undefined, fallback: string): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') && v.length <= 300 ? v : fallback;
}

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const RESUME_ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
