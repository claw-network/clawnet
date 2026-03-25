#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { getNpmPackageNames } from './lib/release-manifest.mjs';

const command = process.argv[2];
const supportedCommands = new Set(['build', 'test']);

if (!supportedCommands.has(command)) {
  console.error('Usage: node scripts/release-check.mjs <build|test>');
  process.exit(1);
}

for (const packageName of getNpmPackageNames()) {
  console.log(`\n▸ ${command} ${packageName}`);
  const result = spawnSync('corepack', ['pnpm', '--filter', packageName, command], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
