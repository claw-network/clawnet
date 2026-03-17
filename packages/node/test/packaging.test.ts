import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('binary packaging config', () => {
  it('includes pkg targets and install script', async () => {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const raw = await readFile(pkgPath, 'utf8');
    const json = JSON.parse(raw) as {
      bin?: Record<string, string>;
      pkg?: { targets?: string[]; outputPath?: string };
    };
    expect(json.bin?.clawnetd).toBeDefined();
    expect(json.pkg?.targets).toEqual(
      expect.arrayContaining(['node18-macos-x64', 'node18-linux-x64', 'node18-win-x64']),
    );
    expect(json.pkg?.outputPath).toBe('dist/pkg');

    const installPath = resolve(process.cwd(), '../../scripts/install.sh');
    const installRaw = await readFile(installPath, 'utf8');
    expect(installRaw).toContain('clawnetd');
  });
});
