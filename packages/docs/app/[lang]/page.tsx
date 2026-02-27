import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { i18n } from '@/lib/i18n';

export default async function LocaleHome(props: { params: Promise<{ lang: string }> }) {
  const { lang } = await props.params;

  if (!i18n.languages.includes(lang)) {
    notFound();
  }

  redirect(`/${lang}/docs`);
}
