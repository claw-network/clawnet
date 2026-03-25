import { defineConfig } from 'vitest/config';

/**
 * Vitest config for integration tests.
 *
 * These tests require a running hardhat node and deployed contracts.
 * Run via: pnpm --filter @claw-network/node test:integration
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
