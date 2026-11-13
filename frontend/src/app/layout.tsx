/**
 * Root layout: deliberately renders nothing of its own. <html>/<body> live in app/[locale]/layout.tsx so the
 * lang attribute is right; app/not-found.tsx renders its own document for paths outside any locale.
 * (Without this file Next.js injects a second <html> for 404s -> "Only one element on document allowed".)
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
