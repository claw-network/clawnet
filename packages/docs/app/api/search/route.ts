import { createTokenizer } from '@orama/tokenizers/mandarin';
import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const { GET } = createFromSource(source, {
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
