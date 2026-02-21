import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@claw-network\/core$/, replacement: resolve(root, '../core/src/index.ts') },
      { find: /^@claw-network\/core\/(.*)$/, replacement: resolve(root, '../core/src/$1') },
      { find: /^@claw-network\/protocol$/, replacement: resolve(root, '../protocol/src/index.ts') },
      { find: /^@claw-network\/protocol\/(.*)$/, replacement: resolve(root, '../protocol/src/$1') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
