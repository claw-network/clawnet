#!/usr/bin/env node
/**
 * ClawNet — Unified version bump for all packages in the monorepo.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch          # 0.5.1 → 0.5.2
 *   node scripts/bump-version.mjs minor          # 0.5.1 → 0.6.0
 *   node scripts/bump-version.mjs major          # 0.5.1 → 1.0.0
 *   node scripts/bump-version.mjs 0.6.0          # explicit version
 *   node scripts/bump-version.mjs patch --dry    # preview only
 *
 * Bumps all non-private packages (core, protocol, sdk, node) to the
 * same version. Private packages (cli, contracts, docs, homepage,
 * wallet) are also bumped to keep the monorepo in sync.
 *
 * Excludes: packages with a fixed version (docs@1.0.0, homepage@1.0.0,
 * wallet@2.0.0, contracts@0.1.0) — these have independent versioning.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');

// ── Packages to bump (all share the same version) ──────────────
const SYNCED_PACKAGES = [
  'packages/core',
  'packages/protocol',
  'packages/sdk',
  'packages/node',
  'packages/cli',
];

// ── Packages with independent versioning (not bumped) ──────────
// packages/contracts, packages/docs, packages/homepage, packages/wallet

// ── Parse arguments ────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const bumpArg = args.find((a) => a !== '--dry');

if (!bumpArg) {
  console.error('Usage: bump-version.mjs <patch|minor|major|x.y.z> [--dry]');
  process.exit(1);
}

// ── Read current version from the first synced package ─────────
function readPkg(dir) {
  const path = join(ROOT, dir, 'package.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writePkg(dir, pkg) {
  const path = join(ROOT, dir, 'package.json');
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}

const currentVersion = readPkg(SYNCED_PACKAGES[0]).version;

// ── Calculate next version ─────────────────────────────────────
function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);
  switch (type) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      // Explicit version — validate semver-like format
      if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(type)) return type;
      console.error(`Invalid version or bump type: "${type}"`);
      process.exit(1);
  }
}

const nextVersion = bumpVersion(currentVersion, bumpArg);

console.log(`\n  ClawNet Version Bump`);
console.log(`  ${currentVersion} → ${nextVersion}${dryRun ? '  (dry run)' : ''}\n`);

// ── Apply version to all synced packages ───────────────────────
for (const dir of SYNCED_PACKAGES) {
  const pkg = readPkg(dir);
  const oldVersion = pkg.version;
  pkg.version = nextVersion;

  if (dryRun) {
    console.log(`  [dry] ${pkg.name}  ${oldVersion} → ${nextVersion}`);
  } else {
    writePkg(dir, pkg);
    console.log(`  ✓ ${pkg.name}  ${oldVersion} → ${nextVersion}`);
  }
}

// ── Also update the Python SDK version if pyproject.toml exists ─
const pyprojectPath = join(ROOT, 'packages/sdk-python/pyproject.toml');
try {
  let toml = readFileSync(pyprojectPath, 'utf-8');
  const match = toml.match(/^version\s*=\s*"([^"]+)"/m);
  if (match) {
    if (dryRun) {
      console.log(`  [dry] clawnet-sdk (PyPI)  ${match[1]} → ${nextVersion}`);
    } else {
      toml = toml.replace(/^(version\s*=\s*")([^"]+)(")/m, `$1${nextVersion}$3`);
      writeFileSync(pyprojectPath, toml);
      console.log(`  ✓ clawnet-sdk (PyPI)  ${match[1]} → ${nextVersion}`);
    }
  }
} catch {
  // Python SDK may not exist — skip silently
}

console.log('');

if (dryRun) {
  console.log('  Dry run — no files modified.\n');
} else {
  console.log(`  Done. All synced packages are now at v${nextVersion}.`);
  console.log('  Next steps:');
  console.log('    pnpm build && pnpm test');
  console.log('    git add -A && git commit -m "chore: bump to v' + nextVersion + '"');
  console.log('    pnpm publish:release\n');
}
