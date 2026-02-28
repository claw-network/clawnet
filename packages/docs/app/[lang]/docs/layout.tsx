import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { isSupportedLanguage } from '@/lib/i18n';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;
  if (!isSupportedLanguage(lang)) {
    notFound();
  }

  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree(lang)}>
      {children}
    </DocsLayout>
  );
}
