import { defineDocs, defineConfig, frontmatterSchema } from 'fumadocs-mdx/config';
import { remarkStructure } from 'fumadocs-core/mdx-plugins';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { remarkMermaid } from './lib/remark-mermaid.mjs';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema.passthrough(),
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMath, remarkMermaid, remarkStructure],
    rehypePlugins: (plugins) => [rehypeKatex, ...plugins],
  },
});
