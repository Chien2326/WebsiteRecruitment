'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Pencil } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { ADMIN_LOCALES, revalidate, type PrefectureAdmin, type RegionAdmin } from '@/lib/admin';
import { localize, type I18nText } from '@/lib/job';
import { Spinner, Toggle, btn, input, useErrorText } from './ui';

type Kind = 'regions' | 'prefectures';

/** Region/prefecture names (6 languages) and map visibility. The 47 prefectures are fixed (JIS codes). */
export default function PlacesAdmin() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const errText = useErrorText();
  const [regions, setRegions] = useState<RegionAdmin[] | null>(null);
  const [prefs, setPrefs] = useState<PrefectureAdmin[]>([]);
  const [editing, setEditing] = useState<{ kind: Kind; id: number; name: I18nText } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ regions: RegionAdmin[]; prefectures: PrefectureAdmin[] }>('/admin/places').then((d) => {
      setRegions(d.regions);
      setPrefs(d.prefectures);
    });
  }, []);

  async function patch(kind: Kind, id: number, body: { is_active?: boolean; name?: I18nText }) {
    setErr(null);
    try {
      const row = await api<RegionAdmin & PrefectureAdmin>(`/admin/${kind}/${id}`, { method: 'PATCH', json: body });
      if (kind === 'regions') setRegions((rs) => rs!.map((r) => (r.id === id ? row : r)));
      else setPrefs((ps) => ps.map((p) => (p.id === id ? row : p)));
      await revalidate(['places']); // public map/search update now
      return true;
    } catch (e) {
      setErr(e instanceof ApiError ? e.code : 'generic');
      return false;
    }
  }

  if (!regions) return <Spinner />;

  const nameEditor = (kind: Kind, id: number) =>
    editing && editing.kind === kind && editing.id === id ? (
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {ADMIN_LOCALES.map((l) => (
          <label key={l} className="block text-xs">
            <span className="font-bold uppercase text-slate-500">{l}{l === 'ja' && ' *'}</span>
            <input
              lang={l}
              className={input}
              value={editing.name[l] ?? ''}
              onChange={(e) => setEditing({ ...editing, name: { ...editing.name, [l]: e.target.value } })}
            />
          </label>
        ))}
        <div className="flex items-end gap-2 sm:col-span-3">
          <button type="button" className={btn.primary} onClick={() => void patch(kind, id, { name: editing.name }).then((ok) => ok && setEditing(null))}>
            <Check className="h-4 w-4" aria-hidden />{t('common.save')}
          </button>
          <button type="button" className={btn.ghost} onClick={() => setEditing(null)}>{t('common.cancel')}</button>
        </div>
      </div>
    ) : null;

  const row = (kind: Kind, item: RegionAdmin | PrefectureAdmin, indent = false) => (
    <li key={`${kind}-${item.id}`} className={`py-2 ${indent ? 'pl-6' : ''}`}>
      <div className="flex items-center gap-3">
        <Toggle
          checked={item.is_active}
          onChange={(v) => void patch(kind, item.id, { is_active: v })}
          label={`${localize(item.name, locale)}: ${item.is_active ? t('places.visible') : t('places.hidden')}`}
        />
        <span className={`min-w-0 flex-1 ${item.is_active ? '' : 'text-slate-400 line-through'} ${indent ? 'text-sm' : 'font-bold text-navy'}`}>
          {localize(item.name, locale)}
          <span className="ml-2 text-xs font-normal text-slate-400">
            {ADMIN_LOCALES.filter((l) => item.name[l]).length}/6
          </span>
        </span>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`${t('places.editNames')}: ${localize(item.name, locale)}`}
          onClick={() => setEditing({ kind, id: item.id, name: { ...item.name } })}>
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {nameEditor(kind, item.id)}
    </li>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-navy">{t('places.title')}</h1>
        <p className="text-sm text-slate-600">{t('places.hint')}</p>
      </div>
      {err && <p role="alert" className="text-sm text-red-700">{errText(err)}</p>}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <ul className="divide-y divide-slate-100">
          {regions.map((r) => (
            <li key={r.id} className="py-1">
              <ul>
                {row('regions', r)}
                {prefs.filter((p) => p.region_id === r.id).map((p) => row('prefectures', p, true))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
