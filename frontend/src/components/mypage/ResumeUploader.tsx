'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, UploadCloud } from 'lucide-react';
import { ApiError, MAX_RESUME_BYTES, RESUME_ACCEPT, uploadResume, type Resume } from '@/lib/api';

/** Drag & drop / tap-to-pick uploader with progress. Client checks are UX only; the server re-validates bytes. */
export default function ResumeUploader({ onUploaded, compact = false }: { onUploaded: (r: Resume) => void; compact?: boolean }) {
  const t = useTranslations('profile');
  const te = useTranslations('errors');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handle(file: File | undefined) {
    if (!file) return;
    setErr(null);
    setDone(false);
    const ext = file.name.toLowerCase().split('.').pop();
    if (ext !== 'pdf' && ext !== 'docx') return setErr('unsupported_type');
    if (file.size > MAX_RESUME_BYTES) return setErr('file_too_large');
    setProgress(0);
    try {
      const r = await uploadResume(file, setProgress);
      setDone(true);
      onUploaded(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void handle(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-center transition ${
          compact ? 'p-4' : 'p-6'
        } ${drag ? 'border-brand bg-brand-light' : 'border-slate-300 bg-slate-50 hover:border-brand hover:bg-brand-light/50'}`}
      >
        <UploadCloud className={`text-brand ${compact ? 'h-7 w-7' : 'h-9 w-9'}`} aria-hidden />
        <span className="font-bold text-navy">{t('chooseFile')}</span>
        <span className="hidden text-xs text-slate-500 md:block">{t('dropHere')}</span>
        <span className="text-xs text-slate-500">{t('resumesHint')}</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={RESUME_ACCEPT}
          className="sr-only"
          disabled={progress !== null}
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </label>

      {progress !== null && (
        <div className="mt-3" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-600">{t('uploading', { percent: progress })}</p>
        </div>
      )}
      {done && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700" role="status">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t('uploaded')}
        </p>
      )}
      {err && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {te.has(err) ? te(err) : te('generic')}
        </p>
      )}
    </div>
  );
}
