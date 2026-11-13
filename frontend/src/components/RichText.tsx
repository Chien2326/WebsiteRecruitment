import { Fragment, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Renders the small text format used for news bodies, as React elements (never as HTML, so nothing an
 * editor types can run as script):
 *   blank line = new paragraph · "## " heading · "- " list item · **bold** · [text](https://… or /path)
 * Links: only https:, http: and site-relative paths ("/jobs"); anything else (javascript:, data:…) is plain text.
 */
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g;

function safeHref(href: string): { internal: boolean; href: string } | null {
  if (href.startsWith('/') && !href.startsWith('//')) return { internal: true, href };
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? { internal: false, href: u.toString() } : null;
  } catch {
    return null;
  }
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[1] !== undefined) {
      out.push(<strong key={key} className="font-bold text-navy">{m[1]}</strong>);
    } else {
      const link = safeHref(m[3]);
      if (!link) out.push(m[2]);
      else if (link.internal) out.push(<Link key={key} href={link.href} className="text-navy underline hover:text-brand">{m[2]}</Link>);
      else out.push(<a key={key} href={link.href} target="_blank" rel="noopener noreferrer nofollow" className="text-navy underline hover:text-brand">{m[2]}</a>);
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Line breaks inside a paragraph are kept. */
function lines(text: string, keyBase: string): ReactNode[] {
  return text.split('\n').map((l, i, all) => (
    <Fragment key={`${keyBase}-l${i}`}>
      {inline(l, `${keyBase}-l${i}`)}
      {i < all.length - 1 && <br />}
    </Fragment>
  ));
}

export default function RichText({ text, lang }: { text: string; lang?: string }) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div lang={lang} className="space-y-4 text-base leading-relaxed text-slate-800">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.startsWith('## ')) {
          return <h2 key={key} className="pt-2 text-lg font-bold text-navy">{inline(b.slice(3), key)}</h2>;
        }
        const rows = b.split('\n');
        if (rows.every((r) => r.startsWith('- '))) {
          return (
            <ul key={key} className="list-disc space-y-1 pl-6">
              {rows.map((r, j) => <li key={`${key}-${j}`}>{inline(r.slice(2), `${key}-${j}`)}</li>)}
            </ul>
          );
        }
        return <p key={key}>{lines(b, key)}</p>;
      })}
    </div>
  );
}
