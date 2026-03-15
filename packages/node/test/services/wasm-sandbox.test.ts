/**
 * Tests for WasmSandbox — Extism-based WASM script verification & execution.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { blake3Hex } from '@claw-network/core';

// ---------------------------------------------------------------------------
// Mock @extism/extism — vi.hoisted ensures these are available during factory
// ---------------------------------------------------------------------------
const { mockCall, mockFunctionExists, mockClose, mockCreatePlugin } = vi.hoisted(() => {
  const mockCall = vi.fn();
  const mockFunctionExists = vi.fn();
  const mockClose = vi.fn();
  const mockPlugin = {
    call: mockCall,
    functionExists: mockFunctionExists,
    close: mockClose,
  };
  const mockCreatePlugin = vi.fn().mockResolvedValue(mockPlugin);
  return { mockCall, mockFunctionExists, mockClose, mockCreatePlugin };
});

vi.mock('@extism/extism', () => ({
  default: mockCreatePlugin,
  __esModule: true,
}));

// Import AFTER mock is set up
import { WasmSandbox } from '../../src/services/wasm-sandbox.js';

// Helpers
function makeBytes(data: number[]): Uint8Array {
  return new Uint8Array(data);
}

describe('WasmSandbox', () => {
  const sandbox = new WasmSandbox();

  beforeEach(() => {
    vi.clearAllMocks();
    mockClose.mockResolvedValue(undefined);
  });

  describe('verifyScriptHash', () => {
    it('passes for matching hash', () => {
      const bytes = makeBytes([1, 2, 3, 4]);
      const hash = blake3Hex(bytes);
      expect(sandbox.verifyScriptHash(bytes, hash)).toBe(true);
    });

    it('fails for mismatched hash', () => {
      const bytes = makeBytes([1, 2, 3, 4]);
      expect(sandbox.verifyScriptHash(bytes, 'deadbeef'.repeat(8))).toBe(false);
    });
  });

  describe('execute', () => {
    it('rejects script with hash mismatch', async () => {
      const bytes = makeBytes([1, 2, 3]);
      const content = makeBytes([4, 5, 6]);
      const result = await sandbox.execute(bytes, content, 'wrong-hash');
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Script hash mismatch');
      expect(mockCreatePlugin).not.toHaveBeenCalled();
    });

    it('runs verify and returns passed result', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(true);
      mockCall.mockResolvedValue({
        json: () => ({ passed: true, details: 'all checks passed' }),
        text: () => '{"passed":true,"details":"all checks passed"}',
      });

      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(true);
      expect(result.output).toBe('all checks passed');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockCreatePlugin).toHaveBeenCalledOnce();
      expect(mockCall).toHaveBeenCalledWith('verify', content);
      expect(mockClose).toHaveBeenCalledOnce();
    });

    it('returns failed result from plugin', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(true);
      mockCall.mockResolvedValue({
        json: () => ({ passed: false, details: 'assertion X failed' }),
        text: () => '{"passed":false,"details":"assertion X failed"}',
      });

      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.output).toBe('assertion X failed');
    });

    it('errors when plugin has no verify export', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(false);

      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('does not export a "verify" function');
      expect(mockCall).not.toHaveBeenCalled();
    });

    it('handles null output from plugin', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(true);
      mockCall.mockResolvedValue(null);

      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.error).toBe('Plugin returned no output');
    });

    it('handles invalid JSON output', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(true);
      mockCall.mockResolvedValue({
        json: () => { throw new SyntaxError('Unexpected token'); },
        text: () => 'not json at all',
      });

      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Invalid plugin output (not JSON)');
    });

    it('handles plugin creation failure', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockCreatePlugin.mockRejectedValueOnce(new Error('Invalid WASM module'));

      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.error).toBe('Invalid WASM module');
    });

    it('handles execution timeout', async () => {
      const fastSandbox = new WasmSandbox({ timeoutMs: 50 });
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(true);
      // Simulate a plugin call that never resolves
      mockCall.mockReturnValue(new Promise(() => {}));

      const result = await fastSandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('creates plugin with correct security options', async () => {
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([4, 5, 6]);

      mockFunctionExists.mockResolvedValue(true);
      mockCall.mockResolvedValue({
        json: () => ({ passed: true }),
        text: () => '{"passed":true}',
      });

      await sandbox.execute(bytes, content, hash);

      const [manifest, opts] = mockCreatePlugin.mock.calls[0];
      expect(manifest.wasm[0].data).toBe(bytes);
      expect(opts.useWasi).toBe(true);
      expect(opts.allowedHosts).toEqual([]);
      expect(opts.enableWasiOutput).toBe(true);
    });
  });

  describe('constructor options', () => {
    it('accepts custom memory and timeout', () => {
      const s = new WasmSandbox({ maxMemoryBytes: 1024, timeoutMs: 1000 });
      expect(s).toBeDefined();
    });

    it('accepts allowedPaths', async () => {
      const s = new WasmSandbox({ allowedPaths: { '/data': '/tmp/test-data' } });
      const bytes = makeBytes([10, 20, 30]);
      const hash = blake3Hex(bytes);
      const content = makeBytes([1]);

      mockFunctionExists.mockResolvedValue(true);
      mockCall.mockResolvedValue({
        json: () => ({ passed: true }),
        text: () => '{"passed":true}',
      });

      await s.execute(bytes, content, hash);

      const [, opts] = mockCreatePlugin.mock.calls[0];
      expect(opts.allowedPaths).toEqual({ '/data': '/tmp/test-data' });
    });
  });
});
