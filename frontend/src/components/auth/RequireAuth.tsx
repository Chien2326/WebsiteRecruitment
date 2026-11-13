'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSession } from './SessionProvider';

/** Client-side gate for candidate pages. The API enforces auth anyway; this only handles the UX redirect. */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();

  useEffect(() => {
    if (!loading && !user) router.replace({ pathname: '/login', query: { next: `/${locale}${pathname}` } });
  }, [loading, user, router, pathname, locale]);

  if (loading || !user) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-slate-400" role="status">
        <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
      </div>
    );
  }
  return <>{children}</>;
}
