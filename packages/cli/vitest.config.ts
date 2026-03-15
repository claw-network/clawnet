import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@claw-network\/core$/, replacement: resolve(__dirname, '../core/src/index.ts') },
      { find: /^@claw-network\/core\/(.*)$/, replacement: resolve(__dirname, '../core/src/$1') },
      { find: /^@claw-network\/protocol$/, replacement: resolve(__dirname, '../protocol/src/index.ts') },
      { find: /^@claw-network\/protocol\/(.*)$/, replacement: resolve(__dirname, '../protocol/src/$1') },
      { find: /^@claw-network\/node$/, replacement: resolve(__dirname, '../node/src/index.ts') },
      { find: /^@claw-network\/node\/(.*)$/, replacement: resolve(__dirname, '../node/src/$1') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
