import { redirect } from 'next/navigation';

export default async function LocaleHome(props: { params: Promise<{ lang: string }> }) {
  const { lang } = await props.params;
  redirect(`/${lang}/docs`);
}
