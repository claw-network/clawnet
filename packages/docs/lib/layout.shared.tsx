import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'ClawNet Docs',
    },
    links: [
      {
        text: 'GitHub',
        url: 'https://github.com/claw-network',
      },
    ],
  };
}
