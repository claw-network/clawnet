#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const PUBLIC_FILES = [
  'README.md',
  '.github/copilot-instructions.md',
  '.github/copilot-instructions.public.md',
  'docs/API_REFERENCE.md',
  'docs/SDK_GUIDE.md',
  'docs/QUICKSTART.md',
  'docs/DEPLOYMENT.md',
  'docs/FAQ.md',
  'packages/homepage/src/content/site.ts',
];

const PUBLIC_DIRS = ['packages/docs/content/docs'];

const RULES = [
  {
    name: 'legacy API route family',
    regex: /\/api\/(?!v1\/)(?:node|identity|wallet|reputation|markets|contracts|dao|dev)\b/g,
  },
  {
    name: 'outdated chain wording',
    regex: /\bGeth PoA\b|\bClique PoA\b|\bGeth v1\.13\.15\b/g,
  },
  {
    name: 'deprecated install domain',
    regex: /clawnet\.network/g,
  },
  {
    name: 'deprecated root docs link',
    regex:
      /https:\/\/github\.com\/claw-network\/clawnet\/(?:blob|tree)\/main\/docs\/(?!api\/openapi\.yaml)[^\s)'"]+/g,
  },
  {
    name: 'deleted archive page reference',
    regex: /API_ROUTE_CATALOG\.md|api-design-draft\.md/g,
  },
];

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(full));
      continue;
    }
    const extension = extname(entry.name);
    if (extension === '.md' || extension === '.mdx') {
      results.push(full);
    }
  }
  return results;
}

function collectPackageReadmes() {
  const packagesDir = join(ROOT, 'packages');
  const results = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(packagesDir, entry.name, 'README.md');
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      results.push(candidate);
    }
  }
  return results;
}

const files = new Set(
  [
    ...PUBLIC_FILES.map(file => join(ROOT, file)),
    ...PUBLIC_DIRS.flatMap(dir => walk(join(ROOT, dir))),
    ...collectPackageReadmes(),
  ].filter(file => existsSync(file)),
);

const findings = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      if (!rule.regex.test(line)) continue;
      findings.push({
        file: rel,
        line: index + 1,
        rule: rule.name,
        text: line.trim(),
      });
    }
  }
}

if (findings.length > 0) {
  console.error('Public documentation drift check failed:\n');
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`,
    );
  }
  process.exit(1);
}

console.log(`Public documentation drift check passed (${files.size} files scanned).`);
