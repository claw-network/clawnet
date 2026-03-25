#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

export const releaseManifest = Object.freeze({
  npmPackageDirs: Object.freeze([
    'packages/sdk',
    'packages/node',
  ]),
  versionedPackageDirs: Object.freeze([
    'packages/sdk',
    'packages/node',
  ]),
  pythonPackageDir: 'packages/sdk-python',
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export function readPackageJson(dir) {
  return readJson(join(ROOT, dir, 'package.json'));
}

export function getNpmPackageNames() {
  return releaseManifest.npmPackageDirs.map((dir) => readPackageJson(dir).name);
}

export function getVersionedPackageNames() {
  return releaseManifest.versionedPackageDirs.map((dir) => readPackageJson(dir).name);
}

function printItems(items) {
  for (const item of items) {
    console.log(item);
  }
}

function main() {
  const command = process.argv[2];

  switch (command) {
    case 'npm-package-dirs':
      printItems(releaseManifest.npmPackageDirs);
      return;
    case 'versioned-package-dirs':
      printItems(releaseManifest.versionedPackageDirs);
      return;
    case 'npm-package-names':
      printItems(getNpmPackageNames());
      return;
    case 'versioned-package-names':
      printItems(getVersionedPackageNames());
      return;
    case 'python-package-dir':
      console.log(releaseManifest.pythonPackageDir);
      return;
    default:
      console.error(
        'Usage: node scripts/lib/release-manifest.mjs ' +
        '<npm-package-dirs|versioned-package-dirs|npm-package-names|versioned-package-names|python-package-dir>',
      );
      process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
