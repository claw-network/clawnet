import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const coreSrc = resolve(rootDir, 'core', 'src');
const protocolSrc = resolve(rootDir, 'protocol', 'src');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    alias: [
      { find: /^@clawtoken\/core$/, replacement: resolve(coreSrc, 'index.ts') },
      { find: /^@clawtoken\/core\/(.*)$/, replacement: `${coreSrc}/$1` },
      { find: /^@clawtoken\/protocol$/, replacement: resolve(protocolSrc, 'index.ts') },
      { find: /^@clawtoken\/protocol\/(.*)$/, replacement: `${protocolSrc}/$1` },
    ],
  },
});
