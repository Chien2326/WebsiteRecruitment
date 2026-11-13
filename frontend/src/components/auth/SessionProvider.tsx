'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, maybeLoggedIn, refreshSession, type Me } from '@/lib/api';

type Session = {
  user: Me | null;
  loading: boolean;
  reload: () => Promise<Me | null>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    let me: Me | null = null;
    if (maybeLoggedIn()) {
      try {
        me = await api<Me>('/auth/me');
      } catch {
        // access token expired -> one silent refresh
        if (await refreshSession()) me = await api<Me>('/auth/me').catch(() => null);
      }
    }
    setUser(me);
    setLoading(false);
    return me;
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ user, loading, reload, logout }), [user, loading, reload, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
