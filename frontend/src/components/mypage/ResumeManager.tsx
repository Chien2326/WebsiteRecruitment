'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Eye, FileText, Loader2, Star, Trash2 } from 'lucide-react';
import { ApiError, api, type Resume } from '@/lib/api';
import ResumeUploader from './ResumeUploader';
import { latn } from '@/lib/format';

export default function ResumeManager({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const t = useTranslations('profile');
  const te = useTranslations('errors');
  const f = latn(useFormatter());
  const [items, setItems] = useState<Resume[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api<Resume[]>('/resumes').then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (items) onCountChange?.(items.length);
  }, [items, onCountChange]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    } finally {
      setBusy(null);
    }
  }

  async function view(id: string) {
    // The 15-min presigned URL forces `Content-Disposition: attachment`, so this downloads the file
    // without leaving the page (and never renders an uploaded file inline in our origin).
    try {
      const { url } = await api<{ url: string }>(`/resumes/${id}/download-url`);
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    }
  }

  const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

  return (
    <div className="space-y-3">
      {items === null ? (
        <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">{t('noResumes')}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xs font-bold uppercase ${
                  r.file_type === 'pdf' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                }`}
              >
                <FileText className="h-5 w-5" aria-hidden />
                <span className="sr-only">{r.file_type}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-slate-800">{r.original_filename}</span>
                  {r.is_default && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                      {t('default')}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-slate-500">
                  {size(r.file_size_bytes)} ・ {f.dateTime(new Date(r.uploaded_at), { dateStyle: 'medium' })}
                </span>
              </span>
              {busy === r.id ? (
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
              ) : (
                <span className="flex shrink-0 items-center">
                  <button type="button" onClick={() => void view(r.id)} className="grid h-10 w-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" aria-label={`${t('view')}: ${r.original_filename}`}>
                    <Eye className="h-5 w-5" aria-hidden />
                  </button>
                  {!r.is_default && (
                    <button
                      type="button"
                      onClick={() => void act(r.id, () => api(`/resumes/${r.id}/default`, { method: 'PATCH' }))}
                      className="grid h-10 w-10 place-items-center rounded-lg text-amber-600 hover:bg-amber-50"
                      aria-label={`${t('setDefault')}: ${r.original_filename}`}
                    >
                      <Star className="h-5 w-5" aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('confirmDelete'))) void act(r.id, () => api(`/resumes/${r.id}`, { method: 'DELETE' }));
                    }}
                    className="grid h-10 w-10 place-items-center rounded-lg text-red-600 hover:bg-red-50"
                    aria-label={`${t('delete')}: ${r.original_filename}`}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="text-sm text-red-700">{te.has(err) ? te(err) : te('generic')}</p>}
      {(items?.length ?? 0) < 5 && <ResumeUploader onUploaded={() => void load()} />}
    </div>
  );
}
