import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');
const API_URL = process.env.API_URL ?? 'http://localhost:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Browser talks to /api on the SAME origin; Next proxies to FastAPI. Session cookies stay first-party
  // (no CORS, no third-party cookies). In production Nginx does the same routing in front of both.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  webpack(config) {
    // pdfjs-dist has an optional Node-only `canvas` dependency; the browser build never needs it.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default withNextIntl(nextConfig);
