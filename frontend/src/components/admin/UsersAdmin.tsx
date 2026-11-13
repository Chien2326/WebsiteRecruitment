'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { useSession } from '@/components/auth/SessionProvider';
import { ApiError, api } from '@/lib/api';
import { STAFF_ROLES, qs, type Page, type UserAdmin } from '@/lib/admin';
import { Pagination, Spinner, Toggle, input, useErrorText } from './ui';
import { latn } from '@/lib/format';

export default function UsersAdmin() {
  const t = useTranslations('admin');
  const f = latn(useFormatter());
  const errText = useErrorText();
  const { user: me } = useSession();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<UserAdmin> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api<Page<UserAdmin>>(`/admin/users${qs({ role, q, page, page_size: 20 })}`).then(setData).catch(() => setData({ items: [], total: 0, page: 1, page_size: 20 }));
  }, [role, q, page]);
  useEffect(load, [load]);

  async function update(u: UserAdmin, body: { role?: string; is_active?: boolean }) {
    setMsg(null);
    try {
      const saved = await api<UserAdmin>(`/admin/users/${u.id}`, { method: 'PATCH', json: body });
      setData((d) => d && { ...d, items: d.items.map((x) => (x.id === u.id ? saved : x)) });
      setMsg({ ok: true, text: t('users.roleChanged', { email: u.email }) });
    } catch (e) {
      setMsg({ ok: false, text: errText(e instanceof ApiError ? e.code : 'generic') });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-navy">{t('users.title')}</h1>
        <p className="text-sm text-slate-600">{t('users.hint')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label={t('users.role')} className={input.replace('w-full', 'w-auto')} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
          <option value="">{t('users.role')}: {t('common.all')}</option>
          {STAFF_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
        </select>
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">{t('common.search')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className={`${input} pl-8`} placeholder={t('users.email')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      {!data ? <Spinner /> : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('users.email')}</th>
                  <th className="px-3 py-2 font-medium">{t('users.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('users.role')}</th>
                  <th className="px-3 py-2 font-medium">{t('users.active')}</th>
                  <th className="px-3 py-2 font-medium">{t('users.lastLogin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id} className={u.is_active ? '' : 'bg-slate-50 text-slate-400'}>
                      <td className="px-3 py-2">{u.email}{self && <span className="ml-1 text-xs text-slate-400">({t('users.self')})</span>}</td>
                      <td className="px-3 py-2">{u.display_name ?? '–'}</td>
                      <td className="px-3 py-2">
                        <select aria-label={`${t('users.role')}: ${u.email}`} className={`${input.replace('w-full', 'w-auto')} min-h-[34px]`} value={u.role} disabled={self}
                          onChange={(e) => void update(u, { role: e.target.value })}>
                          {STAFF_ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2"><Toggle checked={u.is_active} disabled={self} label={`${t('users.active')}: ${u.email}`} onChange={(v) => void update(u, { is_active: v })} /></td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">{u.last_login_at ? f.dateTime(new Date(u.last_login_at), { dateStyle: 'short', timeStyle: 'short' }) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-3 pb-3"><Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={setPage} /></div>
        </div>
      )}
    </div>
  );
}
