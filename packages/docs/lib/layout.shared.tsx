import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { LanguageSwitcher } from '@/components/language-switcher';
import { i18n } from '@/lib/i18n';

export function baseOptions(): BaseLayoutProps {
  return {
    i18n,
    nav: {
      title: 'ClawNet Docs',
      children: <LanguageSwitcher />,
    },
  };
}
