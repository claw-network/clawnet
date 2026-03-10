/**
 * Tests for WasmSandbox — Phase 3 WASM script verification.
 */

import { describe, it, expect } from 'vitest';
import { WasmSandbox } from '../../src/services/wasm-sandbox.js';
import { blake3Hex } from '@claw-network/core';

describe('WasmSandbox', () => {
  const sandbox = new WasmSandbox();

  describe('verifyScriptHash', () => {
    it('passes for matching hash', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const hash = blake3Hex(bytes);
      expect(sandbox.verifyScriptHash(bytes, hash)).toBe(true);
    });

    it('fails for mismatched hash', () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      expect(sandbox.verifyScriptHash(bytes, 'deadbeef'.repeat(8))).toBe(false);
    });
  });

  describe('execute', () => {
    it('rejects script with hash mismatch', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const content = new Uint8Array([4, 5, 6]);
      const result = await sandbox.execute(bytes, content, 'wrong-hash');
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Script hash mismatch');
    });

    it('returns not-implemented for valid hash', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const hash = blake3Hex(bytes);
      const content = new Uint8Array([4, 5, 6]);
      const result = await sandbox.execute(bytes, content, hash);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('not yet implemented');
    });
  });

  describe('constructor options', () => {
    it('accepts custom memory and timeout', () => {
      const s = new WasmSandbox({ maxMemoryBytes: 1024, timeoutMs: 1000 });
      expect(s).toBeDefined();
    });
  });
});
