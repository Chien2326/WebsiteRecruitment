'use client';

import { useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Turns the plain GET filter form into a client-side navigation that keeps the scroll position (a native submit
 * reloads the whole page and jumps to the top). Without JavaScript the form still submits normally.
 */
export default function FilterFormShell({ action, className, children }: { action: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = new URLSearchParams();
    new FormData(e.currentTarget).forEach((v, k) => { if (typeof v === 'string' && v !== '') q.append(k, v); });
    const s = q.toString();
    startTransition(() => router.push(s ? `${action}?${s}` : action, { scroll: false }));
  };

  return (
    <form method="get" action={action} onSubmit={onSubmit} aria-busy={pending} data-pending={pending || undefined} className={`group/f ${className ?? ''}`}>
      {children}
    </form>
  );
}
