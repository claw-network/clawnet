import { defineDocs, defineConfig, frontmatterSchema } from 'fumadocs-mdx/config';
import { remarkMermaid } from './lib/remark-mermaid.mjs';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema.passthrough(),
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkMermaid],
  },
});
