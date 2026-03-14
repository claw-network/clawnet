import { readFile } from 'node:fs/promises';
import { createTokenizer } from '@orama/tokenizers/mandarin';
import { structure } from 'fumadocs-core/mdx-plugins';
import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';
import remarkMath from 'remark-math';

function stripFrontmatter(content: string): string {
	return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export const { GET } = createFromSource(source, {
	buildIndex: async (page) => {
		let structuredData = page.data.structuredData;

		if (!structuredData && 'load' in page.data && typeof page.data.load === 'function') {
			structuredData = (await page.data.load()).structuredData;
		}

		if (!structuredData && 'absolutePath' in page && typeof page.absolutePath === 'string') {
			const raw = await readFile(page.absolutePath, 'utf8');
			structuredData = structure(stripFrontmatter(raw), [remarkMath]);
		}

		if (!structuredData) {
			throw new Error(`Missing structuredData for page: ${page.url}`);
		}

		return {
			title: page.data.title ?? page.slugs[page.slugs.length - 1] ?? page.url,
			description: page.data.description,
			url: page.url,
			id: page.url,
			structuredData,
		};
	},
	localeMap: {
		en: {
			language: 'english',
		},
		zh: {
			components: {
				tokenizer: createTokenizer(),
			},
			search: {
				threshold: 0,
				tolerance: 0,
			},
		},
	},
});
