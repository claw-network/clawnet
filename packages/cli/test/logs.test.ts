import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogs } from '../src/cli.js';
import { resolveStoragePaths } from '../../core/src/storage/paths.js';

describe('cli logs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnet-logs-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prints log file contents from config', async () => {
    const paths = resolveStoragePaths(tempDir);
    await mkdir(paths.logs, { recursive: true });
    const logFile = join(paths.logs, 'node.log');
    await writeFile(logFile, 'line-1\nline-2\n', 'utf8');
    await writeFile(
      paths.configFile,
      ['network: devnet', 'logging:', `  file: ${logFile}`].join('\n'),
      'utf8',
    );

    const output: string[] = [];
    const writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        output.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);

    await runLogs(['--data-dir', tempDir]);

    writeSpy.mockRestore();
    expect(output.join('')).toContain('line-1');
  });
});
