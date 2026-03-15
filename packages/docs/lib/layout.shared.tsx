import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { i18n } from '@/lib/i18n';

const logoSvg = (
  <svg width="24" height="24" viewBox="0 0 32 32" fill="currentColor" className="text-fd-primary" aria-hidden="true">
    <g>
      <g transform="translate(0,0)"><rect x="3" y="3" width="4" height="4" rx="1.2" /><rect x="3" y="8.5" width="4" height="4" rx="1.2" /><rect x="3" y="14" width="4" height="4" rx="1.2" /><rect x="3" y="19.5" width="4" height="4" rx="1.2" /><rect x="3" y="25" width="4" height="4" rx="1.2" /></g>
      <g transform="translate(0,-2)"><rect x="8.5" y="3" width="4" height="4" rx="1.2" /><rect x="8.5" y="8.5" width="4" height="4" rx="1.2" /><rect x="8.5" y="14" width="4" height="4" rx="1.2" /><rect x="8.5" y="19.5" width="4" height="4" rx="1.2" /><rect x="8.5" y="25" width="4" height="4" rx="1.2" /></g>
      <g transform="translate(0,-3)"><rect x="14" y="3" width="4" height="4" rx="1.2" /><rect x="14" y="8.5" width="4" height="4" rx="1.2" /><rect x="14" y="14" width="4" height="4" rx="1.2" /><rect x="14" y="19.5" width="4" height="4" rx="1.2" /><rect x="14" y="25" width="4" height="4" rx="1.2" /></g>
      <g transform="translate(0,-2)"><rect x="19.5" y="3" width="4" height="4" rx="1.2" /><rect x="19.5" y="8.5" width="4" height="4" rx="1.2" /><rect x="19.5" y="14" width="4" height="4" rx="1.2" /><rect x="19.5" y="19.5" width="4" height="4" rx="1.2" /><rect x="19.5" y="25" width="4" height="4" rx="1.2" /></g>
      <g transform="translate(0,0)"><rect x="25" y="3" width="4" height="4" rx="1.2" /><rect x="25" y="8.5" width="4" height="4" rx="1.2" /><rect x="25" y="14" width="4" height="4" rx="1.2" /><rect x="25" y="19.5" width="4" height="4" rx="1.2" /><rect x="25" y="25" width="4" height="4" rx="1.2" /></g>
    </g>
  </svg>
);

export function baseOptions(): BaseLayoutProps {
  return {
    i18n,
    nav: {
      title: (
        <>
          {logoSvg}
          <span>ClawNet Docs</span>
        </>
      ),
    },
  };
}
