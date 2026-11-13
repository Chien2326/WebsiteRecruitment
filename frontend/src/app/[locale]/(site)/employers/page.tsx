import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  BadgeCheck, CalendarClock, ClipboardList, FileSignature, Globe2, Handshake, Languages, MessagesSquare, ShieldCheck,
  UserSearch, UsersRound, type LucideIcon,
} from 'lucide-react';
import InquiryForm from '@/components/employers/InquiryForm';

type Props = { params: { locale: string } };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'employersPage' });
  return { title: t('metaTitle'), description: t('heroLead') };
}

const BENEFITS: { key: string; icon: LucideIcon }[] = [
  { key: 'speed', icon: CalendarClock },
  { key: 'languages', icon: Languages },
  { key: 'visa', icon: ShieldCheck },
  { key: 'support', icon: Handshake },
];
const STEPS: { key: string; icon: LucideIcon }[] = [
  { key: 'contact', icon: MessagesSquare },
  { key: 'hearing', icon: ClipboardList },
  { key: 'contract', icon: FileSignature },
  { key: 'matching', icon: UserSearch },
  { key: 'start', icon: BadgeCheck },
];
const FAQ = ['cost', 'visa', 'japanese', 'trouble', 'area'] as const;

export default async function EmployersPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const t = await getTranslations('employersPage');

  return (
    <div className="space-y-12">
      {/* hero */}
      <section className="overflow-hidden rounded-3xl bg-navy px-6 py-10 text-white md:px-10 md:py-14">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold">
          <Globe2 className="h-4 w-4" aria-hidden />
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-2xl font-bold leading-snug md:text-3xl">{t('heroTitle')}</h1>
        <p className="mt-3 max-w-2xl text-slate-200">{t('heroLead')}</p>
        <a href="#inquiry" className="mt-6 inline-flex min-h-[48px] items-center rounded-xl bg-brand px-6 font-bold text-white hover:bg-brand-dark">
          {t('cta')}
        </a>
        <dl className="mt-8 grid max-w-xl grid-cols-3 gap-3 text-center">
          {(['languages', 'prefectures', 'support'] as const).map((k) => (
            <div key={k} className="rounded-2xl bg-white/10 px-2 py-3">
              <dt className="text-xs text-slate-300">{t(`stats.${k}.label`)}</dt>
              <dd className="mt-1 text-xl font-bold">{t(`stats.${k}.value`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* benefits */}
      <section aria-labelledby="benefits">
        <h2 id="benefits" className="text-xl font-bold text-navy">{t('benefitsTitle')}</h2>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {BENEFITS.map(({ key, icon: Icon }) => (
            <li key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <Icon className="h-6 w-6 text-brand" aria-hidden />
              <h3 className="mt-2 font-bold text-navy">{t(`benefits.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-slate-600">{t(`benefits.${key}.body`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* industries */}
      <section aria-labelledby="industries" className="rounded-2xl bg-brand-light p-5 md:p-6">
        <h2 id="industries" className="flex items-center gap-2 text-lg font-bold text-navy">
          <UsersRound className="h-5 w-5 text-brand" aria-hidden />
          {t('industriesTitle')}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(['factory', 'logistics', 'food', 'hotel', 'cleaning', 'construction', 'care', 'retail'] as const).map((k) => (
            <li key={k} className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
              {t(`industries.${k}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* flow */}
      <section aria-labelledby="flow">
        <h2 id="flow" className="text-xl font-bold text-navy">{t('flowTitle')}</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-5">
          {STEPS.map(({ key, icon: Icon }, i) => (
            <li key={key} className="relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className="text-xs font-bold text-brand">STEP {i + 1}</span>
              <Icon className="mt-2 h-6 w-6 text-navy" aria-hidden />
              <h3 className="mt-2 font-bold text-navy">{t(`steps.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-slate-600">{t(`steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq">
        <h2 id="faq" className="text-xl font-bold text-navy">{t('faqTitle')}</h2>
        <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {FAQ.map((k) => (
            <details key={k} className="group p-4">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 font-bold text-navy">
                <span><span className="mr-2 text-brand">Q.</span>{t(`faq.${k}.q`)}</span>
                <span className="text-slate-400 transition group-open:rotate-45" aria-hidden>＋</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-slate-700"><span className="mr-2 font-bold text-navy">A.</span>{t(`faq.${k}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* contact form */}
      <section id="inquiry" aria-labelledby="inquiry-title" className="scroll-mt-20 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-8">
        <h2 id="inquiry-title" className="text-xl font-bold text-navy">{t('formTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('formLead')}</p>
        <div className="mt-5">
          <InquiryForm />
        </div>
      </section>
    </div>
  );
}
