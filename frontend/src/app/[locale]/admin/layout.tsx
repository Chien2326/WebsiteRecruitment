import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import AdminShell from '@/components/admin/AdminShell';

export const metadata: Metadata = { title: 'Admin | Haken Work', robots: { index: false, follow: false } };

export default function AdminLayout({ children, params: { locale } }: { children: React.ReactNode; params: { locale: string } }) {
  setRequestLocale(locale);
  return <AdminShell>{children}</AdminShell>;
}
