import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { isSupportedLanguage } from '@/lib/i18n';

export default async function LocaleHome(props: { params: Promise<{ lang: string }> }) {
  const { lang } = await props.params;

  if (!isSupportedLanguage(lang)) {
    notFound();
  }

  redirect(`/${lang}/docs`);
}
