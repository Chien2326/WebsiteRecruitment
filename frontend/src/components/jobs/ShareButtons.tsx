'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Link2, Share2 } from 'lucide-react';

/**
 * Share a job: LINE (most used in Japan), Facebook, X, copy link, and the phone's share sheet when available.
 * The URL is read in the browser (the public host is only known there); nothing is sent anywhere until a click.
 */
export default function ShareButtons({ title }: { title: string }) {
  const t = useTranslations('jobDetail');
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setUrl(window.location.href.split('#')[0]);
    setNative(typeof navigator.share === 'function');
  }, []);

  const u = encodeURIComponent(url);
  const links = [
    { name: 'LINE', href: `https://social-plugins.line.me/lineit/share?url=${u}`, cls: 'bg-[#06C755] text-white' },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, cls: 'bg-[#1877F2] text-white' },
    { name: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${encodeURIComponent(title)}`, cls: 'bg-black text-white' },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t('copyLink'), url);
    }
  }

  const btn = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-bold';
  return (
    <section aria-label={t('share')} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-bold text-navy">
        <Share2 className="h-4 w-4 text-brand" aria-hidden />
        {t('shareTitle')}
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map((l) => (
          <a key={l.name} href={url ? l.href : undefined} target="_blank" rel="noopener noreferrer" className={`${btn} ${l.cls}`}>
            {l.name}
          </a>
        ))}
        <button type="button" onClick={copy} disabled={!url} className={`${btn} border border-slate-300 bg-white text-navy hover:border-navy`}>
          {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          <span aria-live="polite">{copied ? t('copied') : t('copyLink')}</span>
        </button>
        {native && (
          <button
            type="button"
            onClick={() => navigator.share({ title, url }).catch(() => {})}
            className={`${btn} border border-slate-300 bg-white text-navy hover:border-navy`}
          >
            <Share2 className="h-4 w-4" aria-hidden />
            {t('shareMore')}
          </button>
        )}
      </div>
    </section>
  );
}
