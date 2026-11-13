import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Skip Next internals, API routes and files with an extension.
  // NB: in a TS string the dot must be written `\\.` (a single `\.` is just `.`, which would
  // exclude every path longer than one character and silently disable the middleware).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
