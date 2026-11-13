import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Building2, ChevronRight, HelpCircle, Mail } from 'lucide-react';
import ContactForm from '@/components/contact/ContactForm';
import { Link } from '@/i18n/navigation';

type Props = { params: { locale: string } };

export async function generateMetadata({ params: { locale } }: Props) {
  const t = await getTranslations({ locale, namespace: 'contactPage' });
  return { title: t('title') };
}

export default async function ContactPage({ params: { locale } }: Props) {
  setRequestLocale(locale);
  const t = await getTranslations('contactPage');
  const shortcuts = [
    { href: '/faq', icon: HelpCircle, title: t('faqTitle'), text: t('faqText') },
    { href: '/employers', icon: Building2, title: t('employersTitle'), text: t('employersText') },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-navy md:text-2xl">
          <Mail className="h-6 w-6 text-brand" aria-hidden />
          {t('title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t('lead')}</p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {shortcuts.map((s) => (
          <Link key={s.href} href={s.href} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-brand">
            <s.icon className="h-6 w-6 shrink-0 text-brand" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-navy">{s.title}</span>
              <span className="block text-sm text-slate-600">{s.text}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          </Link>
        ))}
      </div>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-8" aria-labelledby="contact-form">
        <h2 id="contact-form" className="text-lg font-bold text-navy">{t('formTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('formLead')}</p>
        <div className="mt-5">
          <ContactForm />
        </div>
      </section>
    </div>
  );
}
