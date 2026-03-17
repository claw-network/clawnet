import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { i18n, isSupportedLanguage } from '@/lib/i18n';
import { defineI18nUI } from 'fumadocs-ui/i18n';
import { RootProvider } from '@/components/root-provider';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      displayName: 'English',
      chooseLanguage: 'Choose Language',
    },
    zh: {
      displayName: '中文',
      chooseLanguage: '切换语言',
      search: '搜索文档',
      searchNoResult: '没有找到结果',
      toc: '目录',
      tocNoHeadings: '本页没有标题',
      lastUpdate: '最后更新',
      nextPage: '下一页',
      previousPage: '上一页',
      chooseTheme: '切换主题',
      editOnGithub: '在 GitHub 编辑',
    },
  },
});

export default async function LocaleLayout({
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
    <RootProvider
      i18n={provider(lang)}
      theme={{ defaultTheme: 'dark' }}
      search={{
        enabled: true,
        options: {
          api: '/api/search',
          type: 'fetch',
        },
      }}
    >
      <DocsLayout {...baseOptions()} tree={source.getPageTree(lang)}>
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
