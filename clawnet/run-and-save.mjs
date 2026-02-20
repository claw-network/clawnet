#!/usr/bin/env node
/**
 * Wrapper that runs run-tests.mjs and saves output to a file.
 * Usage: node run-and-save.mjs [args...]
 * Output written to: test-output.txt
 */
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const startTime = Date.now();
const outFile = createWriteStream(resolve(__dirname, 'test-output.txt'));
const child = spawn('node', ['run-tests.mjs', ...args], {
  cwd: __dirname,
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(outFile);
child.stdout.pipe(process.stdout);
child.stderr.pipe(outFile);
child.stderr.pipe(process.stderr);

child.on('close', (code) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const msg = `\n>>> Test exited with code ${code} in ${elapsed}s`;
  outFile.write(msg + '\n');
  outFile.end();
  console.log(msg);
  process.exit(code);
});
