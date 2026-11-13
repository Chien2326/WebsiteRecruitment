import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/revalidate {"tags": ["translations"]}
 * Lets an admin's save take effect immediately instead of after the cache TTL.
 * (A filesystem route: it wins over the /api/* -> FastAPI rewrite.)
 * Guarded like any state-changing API call: CSRF double-submit + the caller's permissions from FastAPI.
 */
const API_URL = process.env.API_URL ?? 'http://localhost:8000';
const TAG_PERMISSION: Record<string, string> = {
  translations: 'cms.write',
  cms: 'cms.write',
  news: 'cms.write',
  places: 'places.write',
};

export async function POST(req: NextRequest) {
  const csrfCookie = req.cookies.get('csrf_token')?.value;
  if (!csrfCookie || req.headers.get('x-csrf-token') !== csrfCookie) {
    return NextResponse.json({ detail: { code: 'csrf_failed' } }, { status: 403 });
  }
  const me = await fetch(`${API_URL}/api/v1/auth/me`, {
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  });
  if (!me.ok) return NextResponse.json({ detail: { code: 'not_authenticated' } }, { status: 401 });
  const perms = new Set(((await me.json()) as { permissions: string[] }).permissions);

  const body = (await req.json().catch(() => ({}))) as { tags?: unknown };
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [];
  const done: string[] = [];
  for (const tag of tags) {
    const need = TAG_PERMISSION[tag];
    if (!need) continue; // unknown tags are ignored, never forwarded
    if (!perms.has(need)) return NextResponse.json({ detail: { code: 'forbidden' } }, { status: 403 });
    revalidateTag(tag);
    done.push(tag);
  }
  return NextResponse.json({ revalidated: done });
}
