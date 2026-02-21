import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '../src/daemon.js';

describe('clawnetd daemon', () => {
  let tempDir: string;
  let stop: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnetd-'));
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      ['network: devnet', 'logging:', '  level: debug'].join('\n'),
      'utf8',
    );
  });

  afterEach(async () => {
    if (stop) {
      await stop();
      stop = null;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('starts and logs health checks', async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '));
    });

    const result = await startDaemon(
      [
        '--data-dir',
        tempDir,
        '--no-api',
        '--listen',
        '/ip4/127.0.0.1/tcp/0',
        '--health-interval-ms',
        '50',
        '--passphrase',
        'test-passphrase',
      ],
      { attachSignals: false },
    );
    stop = result.stop;

    await new Promise((resolve) => setTimeout(resolve, 120));
    await stop();
    stop = null;

    logSpy.mockRestore();

    const combined = logs.join('\n');
    expect(combined).toContain('health ok');
  });
});
