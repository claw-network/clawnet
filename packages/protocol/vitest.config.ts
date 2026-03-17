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
      { find: /^@claw-network\/core$/, replacement: resolve(coreSrc, 'index.ts') },
      { find: /^@claw-network\/core\/(.*)$/, replacement: `${coreSrc}/$1` },
      { find: /^@claw-network\/protocol$/, replacement: resolve(protocolSrc, 'index.ts') },
      { find: /^@claw-network\/protocol\/(.*)$/, replacement: `${protocolSrc}/$1` },
    ],
  },
});
