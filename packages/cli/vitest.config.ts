import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@clawtoken\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
      { find: /^@clawtoken\/core\/(.*)$/, replacement: resolve(__dirname, '../core/src/$1') },
      { find: /^@clawtoken\/protocol$/, replacement: resolve(__dirname, '../protocol/src/index.ts') },
      { find: /^@clawtoken\/protocol\/(.*)$/, replacement: resolve(__dirname, '../protocol/src/$1') },
      { find: /^@clawtoken\/node$/, replacement: resolve(__dirname, '../node/src/index.ts') },
      { find: /^@clawtoken\/node\/(.*)$/, replacement: resolve(__dirname, '../node/src/$1') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
