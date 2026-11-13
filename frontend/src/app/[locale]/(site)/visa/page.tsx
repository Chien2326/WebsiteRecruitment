import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AlertTriangle, BadgeCheck, BriefcaseBusiness, Clock, IdCard, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { getVisaTypes, localize } from '@/lib/job';

type Props = { params: { locale: string } };

/** Grouped by what each status allows. General guidance only: the residence card / immigration office decide. */
const GROUPS: { key: string; icon: LucideIcon; cls: string; codes: string[] }[] = [
  { key: 'free', icon: BadgeCheck, cls: 'text-emerald-600', codes: ['permanent_resident', 'spouse_of_japanese', 'long_term_resident'] },
  { key: 'limited', icon: BriefcaseBusiness, cls: 'text-navy', codes: ['specified_skilled_1', 'specified_skilled_2', 'engineer_humanities', 'technical_intern'] },
  { key: 'permission', icon: Clock, cls: 'text-amber-600', codes: ['student', 'dependent'] },
];

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'visaPage' });
  return { title: t('title') };
}

export default async function VisaPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const [t, visas] = await Promise.all([getTranslations('visaPage'), getVisaTypes()]);
  const byCode = new Map(visas.map((v) => [v.code, v]));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy md:text-2xl">
          <IdCard className="h-6 w-6 text-brand" aria-hidden />
          {t('title')}
        </h1>
        <p className="mt-2 text-slate-700">{t('lead')}</p>
      </header>

      {GROUPS.map(({ key, icon: Icon, cls, codes }) => (
        <section key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 font-bold text-navy">
            <Icon className={`h-5 w-5 ${cls}`} aria-hidden />
            {t(`groups.${key}.title`)}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">{t(`groups.${key}.body`)}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {codes.filter((c) => byCode.has(c)).map((c) => (
              <li key={c}>
                <Link href={{ pathname: '/jobs', query: { visa: c } }}
                  className="inline-flex min-h-[36px] items-center rounded-full bg-slate-50 px-3 text-sm text-navy ring-1 ring-slate-200 hover:ring-brand">
                  {localize(byCode.get(c)!.name, locale)} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="rounded-2xl bg-navy-light p-5">
        <h2 className="font-bold text-navy">{t('checkTitle')}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>{t('check.card')}</li>
          <li>{t('check.expiry')}</li>
          <li>{t('check.change')}</li>
        </ul>
      </section>

      <p className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {t('disclaimer')}{' '}
          <a href="https://www.moj.go.jp/isa/" target="_blank" rel="noopener noreferrer" className="font-bold underline">{t('isaLink')}</a>
        </span>
      </p>
    </div>
  );
}
