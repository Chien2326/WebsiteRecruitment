import Footer from '@/components/Footer';
import Navbar from '@/components/Navbar';

/** Public site chrome. Route group: does not change URLs. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <Footer />
    </>
  );
}
