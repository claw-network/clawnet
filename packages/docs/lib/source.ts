import { docs } from '@/.source/server';
import { i18n } from '@/lib/i18n';
import { loader } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
  i18n,
});
