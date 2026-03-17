#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'packages', 'node', 'dist', 'pkg');

const renames = [
  { from: 'clawnetd-macos', to: 'clawnetd-macos-x64' },
  { from: 'clawnetd-linux', to: 'clawnetd-linux-x64' },
  { from: 'clawnetd-win.exe', to: 'clawnetd-windows-x64.exe' },
];

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function renameIfPresent({ from, to }) {
  const fromPath = path.join(distDir, from);
  if (!(await pathExists(fromPath))) {
    return;
  }
  const toPath = path.join(distDir, to);
  if (await pathExists(toPath)) {
    await fs.rm(toPath, { force: true });
  }
  await fs.rename(fromPath, toPath);
}

async function main() {
  await Promise.all(renames.map(renameIfPresent));
}

main().catch((error) => {
  console.error('[rename-pkg]', error);
  process.exit(1);
});
