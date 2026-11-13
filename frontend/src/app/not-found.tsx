import './globals.css';

/** 404 for URLs outside a locale (the middleware normally adds one, so this is rare). */
export default function GlobalNotFound() {
  return (
    <html lang="ja">
      <body className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div>
          <p className="text-5xl font-bold text-brand">404</p>
          <p className="mt-3 text-navy">ページが見つかりません / Page not found</p>
          <a href="/" className="mt-6 inline-block rounded-full bg-brand px-6 py-3 font-bold text-white">ハケンワーク</a>
        </div>
      </body>
    </html>
  );
}
