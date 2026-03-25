import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '../src/daemon.js';

describe('clawnetd daemon', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };
  let stop: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'clawnetd-'));
    process.env = {
      ...originalEnv,
      CLAWNET_HOME: tempDir,
      CLAW_LIQUIDITY_ADDRESS: '0x1111111111111111111111111111111111111111',
      CLAW_TREASURY_ADDRESS: '0x2222222222222222222222222222222222222222',
      CLAW_FAUCET_VAULT_ADDRESS: '0x3333333333333333333333333333333333333333',
      CLAW_RISK_RESERVE_ADDRESS: '0x4444444444444444444444444444444444444444',
      CLAW_LIQUIDITY_WALLET_CONTROL: '2/3',
      CLAW_LIQUIDITY_MONTHLY_BUDGET_CAP: '1000',
      CLAW_LIQUIDITY_RECYCLE_INTERVAL_DAYS: '30',
      CLAW_LIQUIDITY_RECYCLE_TO_TREASURY: 'true',
    };
    const configPath = join(tempDir, 'config.yaml');
    await writeFile(
      configPath,
      ['network: devnet', 'logging:', '  level: debug'].join('\n'),
      'utf8',
    );
    await writeFile(join(tempDir, '.env'), 'CLAW_PASSPHRASE=test-passphrase\n', 'utf8');
  });

  afterEach(async () => {
    if (stop) {
      await stop();
      stop = null;
    }
    process.env = { ...originalEnv };
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('starts and logs health checks', { timeout: 30_000 }, async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.map(String).join(' '));
    });

    const result = await startDaemon(
      [
        '--data-dir',
        tempDir,
        '--no-api',
        '--no-bootstrap',
        '--listen',
        '/ip4/127.0.0.1/tcp/0',
        '--health-interval-ms',
        '50',
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

  it('fails when only the current working directory has a .env file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'clawnetd-cwd-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(cwd);
      await writeFile(join(cwd, '.env'), 'CLAW_PASSPHRASE=wrong-place\n', 'utf8');
      await rm(join(tempDir, '.env'), { force: true });

      await expect(
        startDaemon(
          ['--data-dir', tempDir, '--no-api', '--no-bootstrap', '--listen', '/ip4/127.0.0.1/tcp/0'],
          { attachSignals: false },
        ),
      ).rejects.toThrow(`${tempDir}/.env`);
    } finally {
      process.chdir(previousCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
