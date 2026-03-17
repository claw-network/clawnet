'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function toEnglish(pathname: string): string {
  if (pathname.startsWith('/zh/docs')) {
    return pathname.replace('/zh/docs', '/docs');
  }
  if (pathname === '/zh') return '/docs';
  return pathname;
}

function toChinese(pathname: string): string {
  if (pathname.startsWith('/docs')) {
    return pathname.replace('/docs', '/zh/docs');
  }
  if (pathname.startsWith('/en/docs')) {
    return pathname.replace('/en/docs', '/zh/docs');
  }
  if (pathname === '/en') return '/zh/docs';
  return '/zh/docs';
}

export function LanguageSwitcher() {
  const pathname = usePathname();
  const isZh = pathname.startsWith('/zh');

  const enHref = toEnglish(pathname);
  const zhHref = toChinese(pathname);

  return (
    <div className="inline-flex items-center rounded-md border border-fd-border p-0.5 text-xs">
      <Link
        href={enHref}
        className={`rounded px-2 py-1 ${!isZh ? 'bg-fd-accent text-fd-accent-foreground' : 'text-fd-muted-foreground'}`}
      >
        EN
      </Link>
      <Link
        href={zhHref}
        className={`rounded px-2 py-1 ${isZh ? 'bg-fd-accent text-fd-accent-foreground' : 'text-fd-muted-foreground'}`}
      >
        中文
      </Link>
    </div>
  );
}
