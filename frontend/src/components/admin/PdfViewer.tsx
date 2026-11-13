'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

const MAX_PAGES = 10;

/**
 * Safe CV preview.
 * - Gets a 15-min presigned URL (staff-only `inline` variant) and lets PDF.js fetch it directly from storage.
 * - Renders pages to <canvas> only: no browser PDF plugin, no annotation/link layer, PDF scripts never run.
 * - isEvalSupported:false closes CVE-2024-4367 (font-driven JS execution) on this pdf.js line.
 */
export default function PdfViewer({ resumeId }: { resumeId: string }) {
  const t = useTranslations('admin.apps');
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = useState({ shown: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setState('loading');
    (async () => {
      try {
        const { url } = await api<{ url: string }>(`/resumes/${resumeId}/download-url?inline=true`);
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();
        const task = pdfjs.getDocument({ url, isEvalSupported: false, enableXfa: false });
        destroy = () => void task.destroy();
        const doc = await task.promise;
        const box = ref.current;
        if (cancelled || !box) return;
        box.replaceChildren();
        const n = Math.min(doc.numPages, MAX_PAGES);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= n && !cancelled; i++) {
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: ((box.clientWidth || 600) / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.className = 'mb-3 w-full rounded border border-slate-200 bg-white shadow-sm';
          canvas.setAttribute('aria-label', `page ${i}`);
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
          box.appendChild(canvas);
        }
        setPages({ shown: n, total: doc.numPages });
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [resumeId]);

  return (
    <div>
      {state === 'loading' && (
        <div className="grid h-48 place-items-center text-slate-400" role="status"><Loader2 className="h-6 w-6 animate-spin" aria-hidden /></div>
      )}
      {state === 'error' && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" aria-hidden />{t('previewError')}
        </p>
      )}
      <div ref={ref} data-testid="pdf-pages" className="max-h-[70vh] overflow-y-auto rounded-lg bg-slate-100 p-2" hidden={state !== 'ready'} />
      {state === 'ready' && <p className="mt-1 text-xs text-slate-500">{t('pdfPages', { shown: pages.shown, total: pages.total })}</p>}
    </div>
  );
}
