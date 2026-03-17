'use client';

import { FrameworkProvider } from 'fumadocs-core/framework';
import { RootProvider as BaseProvider } from 'fumadocs-ui/provider/base';
import {
  usePathname as useNextPathname,
  useRouter,
  useParams,
} from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Strip the default-locale prefix (/en) that fumadocs i18n middleware inserts
 * via NextResponse.rewrite(). On the server the rewritten URL is visible to
 * usePathname(), but the client only sees the original URL (no /en/ prefix).
 * Without this shim, TreeContextProvider.searchPath fails on the server because
 * tree URLs never contain the locale prefix, causing a hydration text-node
 * mismatch (React error #418).
 */
function usePathnameWithoutLocale(): string {
  const raw = useNextPathname();
  // Remove leading /en when it's the only segment or followed by /
  return raw.replace(/^\/en(?=\/|$)/, '') || '/';
}

function PatchedNextProvider({ children }: { children: ReactNode }) {
  return (
    <FrameworkProvider
      usePathname={usePathnameWithoutLocale}
      useRouter={useRouter}
      useParams={useParams}
      Link={Link as never}
      Image={Image as never}
    >
      {children}
    </FrameworkProvider>
  );
}

type Props = ComponentProps<typeof BaseProvider>;

/**
 * Drop-in replacement for `fumadocs-ui/provider/next` RootProvider that
 * patches usePathname to strip the hidden default-locale prefix.
 */
export function RootProvider(props: Props) {
  return (
    <PatchedNextProvider>
      <BaseProvider {...props}>{props.children}</BaseProvider>
    </PatchedNextProvider>
  );
}
