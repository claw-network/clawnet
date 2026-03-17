import { i18n } from '@/lib/i18n';
import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';

export default createI18nMiddleware(i18n);

export const config = {
  // Match all paths except static files and Next.js internals
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|icon\\.svg|.*\\.png$).*)'],
};
