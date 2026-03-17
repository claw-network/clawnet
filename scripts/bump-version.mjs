#!/usr/bin/env node
/**
 * ClawNet — Unified version bump for all packages in the monorepo.
 *
 * CalVer format: YEAR.SEQ (release) or YEAR.SEQ.PATCH (patch).
 * Patch numbers start from 1.
 *
 * Usage:
 *   node scripts/bump-version.mjs release        # 2026.1 → 2026.2
 *   node scripts/bump-version.mjs patch          # 2026.1 → 2026.1.1
 *   node scripts/bump-version.mjs 2026.3         # explicit version
 *   node scripts/bump-version.mjs release --dry  # preview only
 *
 * Bumps all synced packages (core, protocol, sdk, node, cli) to the
 * same version. Also updates the Python SDK's pyproject.toml.
 *
 * Excludes: packages with independent versioning (docs, homepage,
 * wallet, contracts, console).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// ── Packages to bump (all share the same version) ──────────────
const SYNCED_PACKAGES = [
  'packages/core',
  'packages/protocol',
  'packages/sdk',
  'packages/node',
  'packages/cli',
];

// ── Parse arguments ────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const bumpArg = args.find((a) => a !== '--dry');

if (!bumpArg) {
  console.error('Usage: bump-version.mjs <release|patch|YEAR.SEQ[.PATCH]> [--dry]');
  process.exit(1);
}

// ── Read/write helpers ─────────────────────────────────────────
function readPkg(dir) {
  const path = join(ROOT, dir, 'package.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writePkg(dir, pkg) {
  const path = join(ROOT, dir, 'package.json');
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}

const currentVersion = readPkg(SYNCED_PACKAGES[0]).version;

// ── CalVer version calculation ─────────────────────────────────
function parseCalVer(version) {
  const parts = version.split('.').map(Number);
  if (parts.length === 2) return { year: parts[0], seq: parts[1], patch: null };
  if (parts.length === 3) return { year: parts[0], seq: parts[1], patch: parts[2] };
  return null;
}

function bumpVersion(current, type) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const parsed = parseCalVer(current);

  switch (type) {
    case 'release': {
      if (!parsed) {
        // Migrating from semver — start fresh
        return `${currentYear}.1`;
      }
      if (currentYear > parsed.year) {
        return `${currentYear}.1`;
      }
      return `${parsed.year}.${parsed.seq + 1}`;
    }
    case 'patch': {
      if (!parsed) {
        console.error(`Cannot patch non-CalVer version: "${current}"`);
        process.exit(1);
      }
      // Append or increment PATCH (starts from 1)
      const nextPatch = parsed.patch == null ? 1 : parsed.patch + 1;
      return `${parsed.year}.${parsed.seq}.${nextPatch}`;
    }
    default: {
      // Explicit version — validate CalVer format
      if (/^\d{4}\.\d+(\.\d+)?$/.test(type)) return type;
      console.error(`Invalid version or bump type: "${type}"`);
      console.error('Valid types: release, patch, or explicit YEAR.SEQ[.PATCH]');
      process.exit(1);
    }
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
  console.log(`  Done. All synced packages are now at ${nextVersion}.`);
  console.log('  Next steps:');
  console.log('    pnpm build && pnpm test');
  console.log('    git add -A && git commit -m "chore: bump to ' + nextVersion + '"');
  console.log('    git tag ' + nextVersion + ' && git push && git push origin ' + nextVersion + '\n');
}
