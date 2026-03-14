import { readFile } from 'node:fs/promises';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';
import { createI18nSearchAPI } from 'fumadocs-core/search/server';

function stripFrontmatter(content: string): string {
	return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export const { GET } = createI18nSearchAPI('simple', {
	i18n,
	localeMap: {
		en: 'english',
		zh: 'english',
	},
	indexes: async () => {
		const indexes = source.getLanguages().flatMap(({ language, pages }) =>
			pages.map(async (page) => {
				const raw = await readFile(page.absolutePath, 'utf8');

				return {
					locale: language,
					title: page.data.title ?? page.slugs[page.slugs.length - 1] ?? page.url,
					description: page.data.description,
					content: stripFrontmatter(raw),
					url: page.url,
				};
			}),
		);

		return Promise.all(indexes);
	},
});
