import { i18n } from '@/lib/i18n';
import { createI18nMiddleware } from 'fumadocs-core/i18n/middleware';

export default createI18nMiddleware(i18n);

export const config = {
  matcher: ['/docs/:path*', '/en/docs/:path*', '/zh/docs/:path*'],
};
