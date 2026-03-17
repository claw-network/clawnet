import { redirect } from 'next/navigation';

/**
 * Fallback root page — in practice the i18n middleware rewrites `/` to `/en`
 * so this page is rarely reached. Redirect just in case.
 */
export default function HomePage() {
  redirect('/');
}
