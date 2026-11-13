export type SearchParams = Record<string, string | string[] | undefined>;

/** `?token=` from an emailed link, only if it looks like one of ours (base64url, 10-200 chars). */
export function tokenParam(searchParams: SearchParams): string | undefined {
  const v = searchParams.token;
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^[A-Za-z0-9_-]{10,200}$/.test(s) ? s : undefined;
}
