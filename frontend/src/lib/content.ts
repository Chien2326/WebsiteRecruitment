/** News (お知らせ) + employer inquiry shapes; mirror backend app/schemas.py. */
import type { I18nText } from './job';

const API_URL = process.env.API_URL ?? 'http://localhost:8000';

export interface NewsListItem {
  slug: string;
  title: I18nText;
  summary: I18nText | null;
  published_at: string;
}
export interface NewsPost extends NewsListItem {
  id: string;
  body: I18nText;
}
export interface NewsPage {
  items: NewsListItem[];
  total: number;
  page: number;
  page_size: number;
}

export const NEWS_PAGE_SIZE = 10;

/** Cached 60 s and tagged: an admin save calls revalidate(['news']) so it shows at once. */
export async function getNewsPage(page = 1, pageSize = NEWS_PAGE_SIZE): Promise<NewsPage | null> {
  try {
    const r = await fetch(`${API_URL}/api/v1/news?page=${page}&page_size=${pageSize}`, { next: { revalidate: 60, tags: ['news'] } });
    return r.ok ? ((await r.json()) as NewsPage) : null;
  } catch {
    return null;
  }
}

export async function getNewsPost(slug: string): Promise<NewsPost | null> {
  if (!/^[a-z0-9-]{3,120}$/.test(slug)) return null; // untrusted URL segment
  try {
    const r = await fetch(`${API_URL}/api/v1/news/${slug}`, { next: { revalidate: 60, tags: ['news'] } });
    return r.ok ? ((await r.json()) as NewsPost) : null;
  } catch {
    return null;
  }
}

/* ---------- admin ---------- */
export type ContentStatus = 'draft' | 'published' | 'archived';
export const CONTENT_STATUSES: ContentStatus[] = ['draft', 'published', 'archived'];

export interface NewsAdmin extends Omit<NewsPost, 'published_at'> {
  status: ContentStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export type InquiryStatus = 'new' | 'contacted' | 'closed';
export const INQUIRY_STATUSES: InquiryStatus[] = ['new', 'contacted', 'closed'];

export interface EmployerInquiry {
  id: string;
  kind: 'employer' | 'general';
  company_name: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
  prefecture_id: number | null;
  headcount: number | null;
  message: string;
  locale: string;
  status: InquiryStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}
