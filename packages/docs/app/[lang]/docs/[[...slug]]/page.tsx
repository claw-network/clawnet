import defaultMdxComponents from 'fumadocs-ui/mdx';
import { source } from '@/lib/source';
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { Mermaid } from '@/components/mermaid';

const mdxComponents = { ...defaultMdxComponents, Mermaid };

export default async function Page(props: { params: Promise<{ lang: string; slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  const MDX = page.data.body;

  // Filter TOC depth when frontmatter specifies tocDepth (e.g. tocDepth: 2)
  const tocDepth = (page.data as Record<string, unknown>).tocDepth;
  const toc =
    typeof tocDepth === 'number'
      ? page.data.toc.filter((item) => item.depth <= tocDepth)
      : page.data.toc;

  return (
    <DocsPage toc={toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={mdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams('slug', 'lang');
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
