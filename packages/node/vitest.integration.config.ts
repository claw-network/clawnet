import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));

/**
 * Vitest config for integration tests.
 *
 * These tests require a running hardhat node and deployed contracts.
 * Run via: pnpm --filter @claw-network/node test:integration
 */
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
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
