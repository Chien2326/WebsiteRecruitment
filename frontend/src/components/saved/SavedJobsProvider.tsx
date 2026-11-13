'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/components/auth/SessionProvider';

interface SavedJobs {
  /** null = not a candidate (logged out or staff): no bookmarks. */
  ids: Set<string> | null;
  toggle: (jobId: string) => Promise<void>;
}

const Ctx = createContext<SavedJobs>({ ids: null, toggle: async () => undefined });

/** Loads the candidate's bookmarked job ids once per session, so every card can show its heart. */
export function SavedJobsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const isCandidate = user?.role === 'candidate';
  const [ids, setIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!isCandidate) {
      setIds(null);
      return;
    }
    api<string[]>('/me/saved-jobs/ids').then((x) => setIds(new Set(x))).catch(() => setIds(new Set()));
  }, [isCandidate, user?.id]);

  const toggle = useCallback(async (jobId: string) => {
    if (!ids) return;
    const saved = ids.has(jobId);
    // optimistic, rolled back if the API says no
    setIds((s) => { const n = new Set(s); if (saved) n.delete(jobId); else n.add(jobId); return n; });
    try {
      await api(`/me/saved-jobs/${jobId}`, { method: saved ? 'DELETE' : 'PUT' });
    } catch (e) {
      setIds((s) => { const n = new Set(s); if (saved) n.add(jobId); else n.delete(jobId); return n; });
      throw e;
    }
  }, [ids]);

  const value = useMemo(() => ({ ids, toggle }), [ids, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSavedJobs = () => useContext(Ctx);
